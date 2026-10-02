import { guestVocab } from "./guestVocab";
import { getLocalDeletionTombstones, localFolders, localMovies, replaceLocalDeletionTombstones } from "./localStudyMeta";
import { lightweightCloudState, safeFolder, safeMovie } from "./localCloudPayload";
import { clearSession, loadSession, saveSession } from "./reviewSession";
import { mergeRecords, mergeTombstones } from "./cloudDeletion";
import { supabase } from "./supabaseClient";
import { createRequestDeduper } from "./requestDeduper";
import { getActiveStorageUser, withoutLocalStateNotifications } from "./userStorage";

export const GUEST_MIGRATION_KEY = "lingoclub_guest_migrated_user_v2";
const dedupeRead = createRequestDeduper();
const dedupeHydration = createRequestDeduper();
const dedupeSync = createRequestDeduper();

function recordDiagnostic(fields) {
  if (typeof window === "undefined") return;
  window.__LINGOCLUB_SYNC_DIAGNOSTIC__ = {
    ...(window.__LINGOCLUB_SYNC_DIAGNOSTIC__ || {}),
    ...fields,
    recordedAt: new Date().toISOString(),
  };
}

export function guestMigrationKey(userId) {
  const origin = typeof window === "undefined" ? "unknown-origin" : window.location.origin;
  return `${GUEST_MIGRATION_KEY}_${encodeURIComponent(origin)}_${String(userId || "unknown")}`;
}

function clone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function serializedBytes(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return null; }
}

function localSettings() {
  const settings = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || key.startsWith("lingoclub_supabase_") || key.startsWith("lingoclub_ai_cache_")) continue;
    if (key.startsWith("study_") || key.startsWith("bili_") || key === "pwa_hint_dismissed") {
      settings[key] = localStorage.getItem(key);
    }
  }
  return settings;
}

export async function collectLocalState() {
  const movies = await localMovies.list();
  const folders = await localFolders.list();
  return {
    version: 1,
    vocab: clone(await guestVocab.list()) || [],
    // Keep parsed subtitle cues in the account payload so another device can
    // learn from the transcript even when the original local video is absent.
    movies: movies.map((movie) => clone(safeMovie(movie))).filter(Boolean),
    folders: folders.map((folder) => clone(safeFolder(folder))).filter(Boolean),
    deletedItems: clone(getLocalDeletionTombstones()) || [],
    reviewSession: clone(loadSession()),
    settings: localSettings(),
    updatedAt: new Date().toISOString(),
  };
}

function legacyJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

// Read the pre-account namespace directly. This must run before switching the
// active storage user, otherwise old localhost data is invisible to migration.
export function collectLegacyLocalState() {
  const vocab = legacyJson("scenelab_guest_vocab", []);
  const movies = legacyJson("lingoclub_local_movies_v1", []);
  const folders = legacyJson("lingoclub_local_folders_v1", []);
  return {
    version: 1,
    vocab: Array.isArray(vocab) ? clone(vocab) : [],
    movies: Array.isArray(movies) ? clone(movies).map(safeMovie) : [],
    folders: Array.isArray(folders) ? clone(folders) : [],
    reviewSession: clone(legacyJson("lingoclub_review_session_v1", null)),
    settings: localSettings(),
    updatedAt: new Date().toISOString(),
  };
}

export function stateCounts(state = {}) {
  return {
    vocab: Array.isArray(state.vocab) ? state.vocab.length : 0,
    movies: Array.isArray(state.movies) ? state.movies.length : 0,
    folders: Array.isArray(state.folders) ? state.folders.length : 0,
    review: state.reviewSession ? 1 : 0,
    deleted: Array.isArray(state.deletedItems) ? state.deletedItems.length : 0,
  };
}

export function stateHasData(state = {}) {
  const counts = stateCounts(state);
  return counts.vocab > 0 || counts.movies > 0 || counts.folders > 0 || counts.review > 0
    || counts.deleted > 0 || Object.keys(state.settings || {}).length > 0;
}

export function cloudStateCompaction(state) {
  if (!state || typeof state !== "object") return { needed: false, beforeBytes: 0, afterBytes: 0 };
  const beforeBytes = serializedBytes(state) || 0;
  const afterBytes = serializedBytes(lightweightCloudState(state)) || 0;
  return {
    needed: beforeBytes - afterBytes >= 16_384,
    beforeBytes,
    afterBytes,
  };
}

export function mergeState(local = {}, remote = {}) {
  const deletedItems = mergeTombstones(local.deletedItems, remote.deletedItems);
  const localSession = local.reviewSession;
  const remoteSession = remote.reviewSession;
  const localSessionDate = String(localSession?.dailyQueue?.date || localSession?.date || "");
  const remoteSessionDate = String(remoteSession?.dailyQueue?.date || remoteSession?.date || "");
  const localSavedAt = Date.parse(localSession?.savedAt || 0) || 0;
  const remoteSavedAt = Date.parse(remoteSession?.savedAt || 0) || 0;
  const reviewSession = !localSession
    ? remoteSession
    : !remoteSession
      ? localSession
      : localSessionDate !== remoteSessionDate
    ? (localSessionDate > remoteSessionDate ? localSession : remoteSession)
    : (localSavedAt >= remoteSavedAt ? localSession : remoteSession);
  return {
    version: 1,
    vocab: mergeRecords(local.vocab, remote.vocab, "vocab", deletedItems),
    movies: mergeRecords(local.movies, remote.movies, "movies", deletedItems),
    folders: mergeRecords(local.folders, remote.folders, "folders", deletedItems),
    deletedItems,
    reviewSession: reviewSession || null,
    settings: { ...(remote.settings || {}), ...(local.settings || {}) },
    updatedAt: new Date().toISOString(),
  };
}

export async function restoreLocalState(state) {
  await withoutLocalStateNotifications(async () => {
    replaceLocalDeletionTombstones(state?.deletedItems || []);
    guestVocab.replace(state?.vocab || []);
    await localMovies.replace((state?.movies || []).map((movie) => safeMovie(movie, { dropLocalSubtitles: false })));
    await localFolders.replace((state?.folders || []).map(safeFolder));
    if (state?.reviewSession) saveSession(state.reviewSession);
    else clearSession();
    for (const [key, value] of Object.entries(state?.settings || {})) {
      try { localStorage.setItem(key, String(value)); } catch { /* noop */ }
    }
  });
}

async function performReadUserState(userId) {
  if (!supabase || !userId) throw new Error("Supabase 未配置或用户身份缺失");
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  recordDiagnostic({ readStartedAt: new Date().toISOString(), lastSyncStage: "read-user-state" });
  let response;
  try {
    response = await supabase.from("user_state").select("data,updated_at").eq("user_id", userId).maybeSingle();
  } catch (error) {
    recordDiagnostic({ lastSyncStage: "read-user-state", readThrownError: { code: error?.code, message: error?.message } });
    throw error;
  }
  const { data, error, status } = response;
  recordDiagnostic({
    authUid: userId,
    projectRef: new URL(supabase.supabaseUrl).hostname.split(".")[0],
    readStatus: status,
    readError: error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null,
    userStateExists: Boolean(data),
    readDurationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
    readPayloadBytes: serializedBytes(data?.data || null),
  });
  if (error) throw error;
  if (typeof console !== "undefined") console.info("[LingoClub user_state performance]", JSON.stringify({
    operation: "read",
    durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
    payloadBytes: serializedBytes(data?.data || null),
    found: Boolean(data),
  }));
  return data || null;
}

export function readUserState(userId) {
  const resolvedUserId = userId || getActiveStorageUser();
  return dedupeRead(String(resolvedUserId || "missing-user"), () => performReadUserState(resolvedUserId));
}

// Hydration is deliberately read-only. Local writes are enabled by
// AuthContext only after this promise resolves.
export function hydrateUserState(userId) {
  const resolvedUserId = userId || getActiveStorageUser();
  return dedupeHydration(String(resolvedUserId || "missing-user"), async () => {
    const row = await readUserState(resolvedUserId);
    const local = await collectLocalState();
    const hydrated = mergeState(local, row?.data || {});
    await restoreLocalState(hydrated);
    return { exists: Boolean(row), data: hydrated, remote: row?.data || null, row };
  });
}

async function performSyncUserState(userId, { legacyState = null, remoteRow } = {}) {
  if (!supabase || !userId) throw new Error("Supabase 未配置或用户身份缺失");
  const row = remoteRow === undefined ? await readUserState(userId) : remoteRow;
  recordDiagnostic({ lastSyncStage: "collect-local-state", collectStartedAt: new Date().toISOString() });
  const local = await collectLocalState();
  recordDiagnostic({ lastSyncStage: "merge-user-state", localCounts: stateCounts(local) });
  const merged = mergeState(local, mergeState(legacyState || {}, row?.data || {}));
  recordDiagnostic({ lastSyncStage: "sanitize-cloud-payload" });
  const cloudData = lightweightCloudState(merged);
  recordDiagnostic({ localCounts: stateCounts(merged), writeRequested: false });
  // Never create a cloud row from an empty browser. This prevents a fresh
  // production origin from becoming the source of truth before hydration.
  if (!row && !stateHasData(merged)) {
    await restoreLocalState(merged);
    return { data: merged, written: false };
  }
  const payload = {
    user_id: userId,
    data: cloudData,
    updated_at: new Date().toISOString(),
  };
  const writeQuery = row
    ? supabase.from("user_state").update(payload).eq("user_id", userId).select("data,updated_at").single()
    : supabase.from("user_state").insert(payload).select("data,updated_at").single();
  recordDiagnostic({ writeRequested: true, writeMethod: row ? "PATCH" : "POST" });
  recordDiagnostic({ lastSyncStage: row ? "update-user-state" : "insert-user-state", writeStartedAt: new Date().toISOString() });
  let writeResponse;
  try {
    writeResponse = await writeQuery;
  } catch (error) {
    recordDiagnostic({ lastSyncStage: row ? "update-user-state" : "insert-user-state", writeThrownError: { code: error?.code, message: error?.message } });
    throw error;
  }
  const { data: saved, error: writeError, status } = writeResponse;
  recordDiagnostic({
    writeStatus: status,
    writeError: writeError ? {
      code: writeError.code,
      message: writeError.message,
      details: writeError.details,
      hint: writeError.hint,
    } : null,
    cloudCounts: stateCounts(saved?.data || {}),
  });
  if (writeError) throw writeError;
  if (!saved?.data) throw new Error("user_state 保存后未返回数据");
  await restoreLocalState(merged);
  return { data: saved.data, written: true };
}

export function syncUserState(userId, options = {}) {
  const resolvedUserId = userId || getActiveStorageUser();
  return dedupeSync(String(resolvedUserId || "missing-user"), () => performSyncUserState(resolvedUserId, options));
}
