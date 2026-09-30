import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { collectLegacyLocalState, guestMigrationKey, hydrateUserState, stateHasData, syncUserState } from "./cloudState";
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
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const syncingRef = useRef(false);
  const initializingRef = useRef(new Map());

  const applySession = useCallback(async (session) => {
    const nextUser = toAppUser(session?.user);
    if (!nextUser) {
      initializingRef.current.clear();
      setActiveStorageUser(null);
      setUser(null);
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
      let initialization = initializingRef.current.get(nextUser.id);
      if (!initialization) {
        initialization = (async () => {
          // This first phase is read-only and must finish before user state is
          // exposed, so local change listeners cannot save an empty origin.
          await hydrateUserState(nextUser.id);
          if (shouldMigrateGuest && stateHasData(legacyState)) {
            await syncUserState(nextUser.id, { legacyState });
          } else {
            // Upload existing account-scoped localhost data, but an empty
            // production browser cannot create an empty user_state row.
            await syncUserState(nextUser.id);
          }
          if (shouldMigrateGuest) localStorage.setItem(migrationKey, new Date().toISOString());
        })();
        initializingRef.current.set(nextUser.id, initialization);
      }
      await initialization;
      setAuthError(null);
    } catch (error) {
      initializingRef.current.delete(nextUser.id);
      console.error("[LingoClub user_state sync]", error);
      setAuthError({ type: "sync_unavailable", message: error?.message || "云端同步暂时不可用" });
    }
    setUser(nextUser);
    setIsLoadingAuth(false);
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
        try {
          await syncUserState(user.id);
          window.dispatchEvent(new CustomEvent("lingoclub:cloud-sync-status", { detail: { ok: true } }));
        } catch (error) {
          const stage = window.__LINGOCLUB_SYNC_DIAGNOSTIC__?.lastSyncStage || "unknown";
          const detail = { ok: false, stage, code: error?.code || null, message: error?.message || "云同步失败" };
          console.warn("[LingoClub background cloud sync]", detail);
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
    appPublicSettings: null,
    authChecked: !isLoadingAuth,
    signUp,
    signInWithPassword,
    signInWithGoogle,
    logout,
    navigateToLogin: (returnTo = window.location.pathname) => { window.location.href = `/login?returnTo=${encodeURIComponent(returnTo || "/")}`; },
    checkUserAuth: async () => user,
    checkAppState: async () => null,
  }), [authError, isLoadingAuth, logout, signInWithGoogle, signInWithPassword, signUp, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
