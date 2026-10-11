import { supabase, supabaseConfigured } from "./supabaseClient";

export { RECOMMENDATION_SOURCE_LABELS, formatDuration, groupRecommendationsByDate, groupRecommendationsBySection, quickStudyPath, youtubeThumbnail } from "./dailyRecommendationsFormat.js";

// Rows are inserted by /api/recommendations/import (service role). The browser
// only reads its own rows and updates watched_at / favorited (enforced by RLS).
const COLUMNS = "id,rec_date,youtube_id,url,title,duration_seconds,level,tags,summary_zh,why_relevant,source,watched_at,favorited,created_at";

export function recommendationsAvailable() {
  return Boolean(supabaseConfigured && supabase);
}

export async function listDailyRecommendations({ limit = 200 } = {}) {
  if (!recommendationsAvailable()) return [];
  const { data, error } = await supabase
    .from("daily_recommendations")
    .select(COLUMNS)
    .order("rec_date", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function updateStatus(id, fields) {
  if (!recommendationsAvailable()) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("daily_recommendations")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export const markRecommendationWatched = (id, watchedAt = new Date().toISOString()) =>
  updateStatus(id, { watched_at: watchedAt });

export const setRecommendationFavorite = (id, favorited) =>
  updateStatus(id, { favorited: Boolean(favorited) });
