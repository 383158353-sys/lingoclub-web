import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cloudStateCompaction, collectLegacyLocalState, guestMigrationKey, hydrateUserState, stateHasData, syncUserState } from "./cloudState";
import { supabase, supabaseConfigured } from "./supabaseClient";
import { setActiveStorageUser } from "./userStorage";

const AuthContext = createContext(null);

export const AUTH_STATUS = Object.freeze({ GUEST: "guest", AUTHENTICATED: "authenticated" });

function toAppUser(value) {
  if (!value) return null;
  const metadata = value.user_metadata || {};
  return {
    id: value.id,
    sub: value.id,
    email: value.email || "",
    name: metadata.full_name || metadata.name || value.email || "LingoClub 用户",
    full_name: metadata.full_name || metadata.name || value.email || "LingoClub 用户",
    picture: metadata.avatar_url || metadata.picture || "",
    provider: value.app_metadata?.provider || "email",
    created_at: value.created_at || null,
    created_date: value.created_at || null,
    role: value.app_metadata?.role || metadata.role || "user",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState({ status: typeof navigator !== "undefined" && navigator.onLine ? "syncing" : "offline", lastSyncedAt: null, lastError: null });
  const syncingRef = useRef(false);
  const initializingRef = useRef(new Map());

  const applySession = useCallback(async (session) => {
    const nextUser = toAppUser(session?.user);
    if (!nextUser) {
      initializingRef.current.clear();
      setActiveStorageUser(null);
      setUser(null);
      setCloudSyncStatus((current) => ({ ...current, status: "offline", lastError: null }));
      setIsLoadingAuth(false);
      return null;
    }

    const migrationKey = guestMigrationKey(nextUser.id);
    const shouldMigrateGuest = !localStorage.getItem(migrationKey);
    const legacyState = shouldMigrateGuest ? collectLegacyLocalState() : null;
    try {
      const { data: readyAuth, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const readySession = readyAuth?.session;
      if (!readySession?.access_token || readySession.user?.id !== nextUser.id) {
        throw new Error("Supabase session 尚未就绪或用户身份不一致");
      }
      window.__LINGOCLUB_SYNC_DIAGNOSTIC__ = {
        ...(window.__LINGOCLUB_SYNC_DIAGNOSTIC__ || {}),
        sessionReady: true,
        sessionUserId: readySession.user.id,
        accessTokenPresent: Boolean(readySession.access_token),
      };
      setActiveStorageUser(nextUser.id);
      setUser(nextUser);
      setAuthError(null);
      try {
        const lastSyncedAt = localStorage.getItem(`lingoclub:last-synced:${nextUser.id}`);
        if (lastSyncedAt) setCloudSyncStatus((current) => ({ ...current, lastSyncedAt }));
      } catch { /* storage is optional */ }
      // Authentication is enough to render. Account hydration continues in
      // the background and never holds the page behind the auth spinner.
      setIsLoadingAuth(false);
      let initialization = initializingRef.current.get(nextUser.id);
      if (!initialization) {
        initialization = (async () => {
          const hydrated = await hydrateUserState(nextUser.id);
          window.dispatchEvent(new CustomEvent("lingoclub:cloud-state-hydrated", { detail: { userId: nextUser.id } }));
          const compaction = cloudStateCompaction(hydrated.remote);
          window.__LINGOCLUB_SYNC_DIAGNOSTIC__ = {
            ...(window.__LINGOCLUB_SYNC_DIAGNOSTIC__ || {}),
            compaction,
          };
          if ((shouldMigrateGuest && stateHasData(legacyState)) || compaction.needed) {
            // Reuse the row already fetched by hydration. The old startup path
            // performed a second GET before every initial PATCH.
            await syncUserState(nextUser.id, { legacyState, remoteRow: hydrated.row });
          }
          const syncAt = new Date().toISOString();
          localStorage.setItem(`lingoclub:last-synced:${nextUser.id}`, syncAt);
          setCloudSyncStatus({ status: "synced", lastSyncedAt: syncAt, lastError: null });
          if (shouldMigrateGuest) localStorage.setItem(migrationKey, new Date().toISOString());
        })();
        initializingRef.current.set(nextUser.id, initialization);
        initialization.catch((error) => {
          initializingRef.current.delete(nextUser.id);
          console.error("[LingoClub user_state sync]", error);
          setAuthError({ type: "sync_unavailable", message: error?.message || "云端同步暂时不可用" });
          setCloudSyncStatus((current) => ({ ...current, status: navigator.onLine ? "error" : "offline", lastError: "学习数据暂时未同步" }));
        });
      }
    } catch (error) {
      initializingRef.current.delete(nextUser.id);
      console.error("[LingoClub user_state sync]", error);
      setAuthError({ type: "sync_unavailable", message: error?.message || "云端同步暂时不可用" });
      setCloudSyncStatus((current) => ({ ...current, status: navigator.onLine ? "error" : "offline", lastError: "学习数据暂时未同步" }));
      setUser(nextUser);
      setIsLoadingAuth(false);
    }
    return nextUser;
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setIsLoadingAuth(false);
      return undefined;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError({ type: "session", message: error.message });
      void applySession(data?.session || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) void applySession(session);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, [applySession]);

  useEffect(() => {
    if (!user || !supabase || !initializingRef.current.has(user.id)) return undefined;
    let timer;
    const sync = () => {
      if (syncingRef.current) return;
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        syncingRef.current = true;
        setCloudSyncStatus((current) => ({ ...current, status: navigator.onLine ? "syncing" : "offline", lastError: null }));
        try {
          await initializingRef.current.get(user.id);
          await syncUserState(user.id);
          const lastSyncedAt = new Date().toISOString();
          localStorage.setItem(`lingoclub:last-synced:${user.id}`, lastSyncedAt);
          const detail = { status: "synced", lastSyncedAt, lastError: null };
          setCloudSyncStatus(detail);
          window.dispatchEvent(new CustomEvent("lingoclub:cloud-sync-status", { detail }));
        } catch (error) {
          const stage = window.__LINGOCLUB_SYNC_DIAGNOSTIC__?.lastSyncStage || "unknown";
          const detail = { status: navigator.onLine ? "error" : "offline", lastError: "学习数据暂时未同步", stage, code: error?.code || null };
          console.warn("[LingoClub background cloud sync]", detail);
          setCloudSyncStatus((current) => ({ ...current, ...detail }));
          window.dispatchEvent(new CustomEvent("lingoclub:cloud-sync-status", { detail }));
        }
        syncingRef.current = false;
      }, 500);
    };
    window.addEventListener("lingoclub:local-state-changed", sync);
    window.addEventListener("online", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("lingoclub:local-state-changed", sync);
      window.removeEventListener("online", sync);
    };
  }, [user]);

  useEffect(() => {
    const onOffline = () => setCloudSyncStatus((current) => ({ ...current, status: "offline" }));
    const onOnline = () => { if (user) setCloudSyncStatus((current) => ({ ...current, status: "syncing" })); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); };
  }, [user]);

  const signUp = useCallback(async (email, password) => {
    if (!supabase) throw new Error("Supabase 尚未配置");
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
    return data;
  }, []);

  const signInWithPassword = useCallback(async (email, password) => {
    if (!supabase) throw new Error("Supabase 尚未配置");
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return data;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    throw new Error("Google 登录将在邮箱登录与同步稳定后接入");
  }, []);

  const updateDisplayName = useCallback(async (newName) => {
    const name = String(newName || "").trim();
    if (!name) throw new Error("请输入显示名称");
    if (!supabase) throw new Error("Supabase 尚未配置");
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (error) throw error;
    const next = toAppUser(data.user);
    setUser(next);
    return next;
  }, []);

  const logout = useCallback(async (redirect = false, redirectPath = "/login") => {
    if (supabase) await supabase.auth.signOut();
    setActiveStorageUser(null);
    setUser(null);
    if (redirect) window.location.href = redirectPath || "/login";
  }, []);

  const value = useMemo(() => ({
    user,
    authStatus: user ? AUTH_STATUS.AUTHENTICATED : AUTH_STATUS.GUEST,
    isAuthenticated: !!user,
    isLoadingAuth,
    isLoadingPublicSettings: false,
    authError,
    cloudSyncStatus,
    appPublicSettings: null,
    authChecked: !isLoadingAuth,
    signUp,
    signInWithPassword,
    signInWithGoogle,
    logout,
    updateDisplayName,
    navigateToLogin: (returnTo = window.location.pathname) => { window.location.href = `/login?returnTo=${encodeURIComponent(returnTo || "/")}`; },
    checkUserAuth: async () => user,
    checkAppState: async () => null,
  }), [authError, cloudSyncStatus, isLoadingAuth, logout, signInWithGoogle, signInWithPassword, signUp, updateDisplayName, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
