import { supabase, supabaseConfigured } from "./supabaseClient";

export const articlesAvailable = () => Boolean(supabaseConfigured && supabase);
const SUMMARY_COLUMNS = "id,rec_date,source_url,title,author,outlet,level,tags,summary_zh,read_at,favorited,folder,created_at";
export async function listDailyArticles({ limit = 200 } = {}) {
  if (!articlesAvailable()) return [];
  const { data, error } = await supabase.from("daily_articles").select(SUMMARY_COLUMNS)
    .order("rec_date", { ascending: false }).order("created_at", { ascending: true }).limit(limit);
  if (error) throw error;
  return data || [];
}
export async function getDailyArticle(id) {
  if (!articlesAvailable()) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.from("daily_articles").select(`${SUMMARY_COLUMNS},body_en,analysis`).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
async function updateStatus(id, fields) {
  if (!articlesAvailable()) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.from("daily_articles").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select("id").single();
  if (error) throw error;
  if (!data) throw new Error("文章不存在或无权更新");
}
export const markArticleRead = (id, readAt = new Date().toISOString()) => updateStatus(id, { read_at: readAt });
export const setArticleFavorite = (id, favorited) => updateStatus(id, { favorited: Boolean(favorited) });
export const setArticleFolder = (id, folder) => updateStatus(id, { folder: folder || "" });
