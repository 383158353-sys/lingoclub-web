import { supabase } from "@/lib/supabaseClient";
import { scopedStorageKey } from "@/lib/userStorage";

const STORAGE_KEY = "lingoclub_review_logs_v1";
let syncInFlight = null;
let lastCloudError = null;

function newId() {
  try { return crypto.randomUUID(); } catch { return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`; }
}

function readKey(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function readLocal() {
  const keys = new Set([STORAGE_KEY, scopedStorageKey(STORAGE_KEY)]);
  const byId = new Map();
  for (const key of keys) for (const log of readKey(key)) if (log?.id) byId.set(log.id, log);
  return [...byId.values()].sort((a, b) => Date.parse(a.reviewed_at || 0) - Date.parse(b.reviewed_at || 0));
}

function writeLocal(logs) {
  try { localStorage.setItem(scopedStorageKey(STORAGE_KEY), JSON.stringify(logs)); } catch (error) {
    console.warn("Unable to persist local review logs", error?.name || "storage error");
  }
}

function databaseRow(log, userId) {
  const { cloudSynced, ...row } = log;
  return { ...row, user_id: userId };
}

export function getReviewLogCloudStatus() {
  return { ready: Boolean(supabase) && !lastCloudError, error: lastCloudError };
}

export function appendReviewLog(fields) {
  const log = {
    id: fields.id || newId(),
    vocabulary_id: String(fields.vocabulary_id || ""),
    source_id: fields.source_id ? String(fields.source_id) : null,
    attempt_type: fields.attempt_type === "retry" ? "retry" : "first",
    reviewed_at: fields.reviewed_at || new Date().toISOString(),
    session_id: fields.session_id || null,
    question_type: fields.question_type || "manual",
    user_answer: fields.user_answer ?? null,
    correct_answer: fields.correct_answer ?? null,
    is_correct: Boolean(fields.is_correct),
    rating: Number(fields.rating ?? (fields.is_correct ? 4 : 0)),
    response_time_ms: Number.isFinite(Number(fields.response_time_ms)) ? Math.max(0, Number(fields.response_time_ms)) : null,
    previous_mastery: fields.previous_mastery || "new",
    new_mastery: fields.new_mastery || "learning",
    previous_interval: Number.isFinite(Number(fields.previous_interval)) ? Number(fields.previous_interval) : 0,
    new_interval: Number.isFinite(Number(fields.new_interval)) ? Number(fields.new_interval) : 0,
    previous_next_review_at: fields.previous_next_review_at || null,
    new_next_review_at: fields.new_next_review_at || null,
    review_mode: ["daily", "weak", "mistakes", "random", "manual"].includes(fields.review_mode) ? fields.review_mode : "manual",
    cloudSynced: false,
  };
  const logs = readLocal();
  logs.push(log);
  writeLocal(logs);
  void syncPendingReviewLogs();
  return log;
}

export async function syncPendingReviewLogs() {
  if (!supabase) {
    lastCloudError = "supabase-not-configured";
    return { synced: 0, ready: false };
  }
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      lastCloudError = authError?.code || "session-not-ready";
      return { synced: 0, ready: false };
    }
    const logs = readLocal();
    const pending = logs.filter((log) => !log.cloudSynced);
    if (pending.length) {
      const { error } = await supabase.from("review_logs").upsert(
        pending.map((log) => databaseRow(log, user.id)),
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (error) {
        lastCloudError = error.code || error.message || "review-log-write-failed";
        return { synced: 0, ready: false, error };
      }
      const syncedIds = new Set(pending.map((log) => log.id));
      writeLocal(logs.map((log) => syncedIds.has(log.id) ? { ...log, cloudSynced: true } : log));
    }
    lastCloudError = null;
    return { synced: pending.length, ready: true };
  })().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

export async function loadReviewLogs({ limit = 5000 } = {}) {
  const local = readLocal();
  const sync = await syncPendingReviewLogs();
  if (!sync.ready || !supabase) return local;
  const { data, error } = await supabase.from("review_logs")
    .select("id,user_id,vocabulary_id,source_id,attempt_type,reviewed_at,session_id,question_type,user_answer,correct_answer,is_correct,rating,response_time_ms,previous_mastery,new_mastery,previous_interval,new_interval,previous_next_review_at,new_next_review_at,review_mode")
    .order("reviewed_at", { ascending: false })
    .limit(limit);
  if (error) {
    lastCloudError = error.code || error.message || "review-log-read-failed";
    return local;
  }
  lastCloudError = null;
  const byId = new Map(local.map((log) => [log.id, log]));
  for (const log of data || []) byId.set(log.id, { ...log, cloudSynced: true });
  const merged = [...byId.values()].sort((a, b) => Date.parse(a.reviewed_at || 0) - Date.parse(b.reviewed_at || 0));
  writeLocal(merged);
  return merged;
}
