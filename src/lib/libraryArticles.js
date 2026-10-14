import { supabase } from "./supabaseClient";
import { articleSourceUrl } from "./dailyArticlesFormat.js";

export function validateLibraryArticle(input) {
  const source_url = articleSourceUrl(input.source_url);
  if (!source_url || source_url.length > 2048) throw new Error("请填写有效的 http(s) 出处链接");
  const row = { source_url };
  for (const [key, max] of Object.entries({ title: 300, body_en: 50000, author: 120, outlet: 120, level: 32, summary_zh: 4000 })) {
    if (input[key] != null && typeof input[key] !== "string") throw new Error("文章字段格式无效");
    row[key] = (input[key] || "").trim();
    if (row[key].length > max) throw new Error(`${key} 内容过长`);
  }
  if (!row.title || !row.body_en) throw new Error("请填写标题和英文正文");
  const analysis = input.analysis === undefined ? {} : input.analysis;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis) || JSON.stringify(analysis).length > 200000) throw new Error("精读解析必须是 JSON 对象且不超过 200000 字符");
  return { ...row, analysis, level: row.level || null };
}
async function client() {
  if (!supabase) throw new Error("云端服务未配置");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("请先登录后导入文章");
  return data.user;
}
export async function importLibraryArticle(input) {
  const row = validateLibraryArticle(input);
  const user = await client();
  const { data, error } = await supabase.from("library_articles").insert({ ...row, user_id: user.id }).select("id").single();
  if (error) throw error;
  return data;
}
export async function listLibraryArticles() {
  const user = await client();
  const { data, error } = await supabase.from("library_articles").select("id,title,source_url,outlet,level,summary_zh,read_at,favorited,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}
export async function getLibraryArticle(id) {
  await client();
  const { data, error } = await supabase.from("library_articles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, rec_date: data.created_at.slice(0, 10) } : null;
}
async function status(id, fields) {
  await client();
  const { error } = await supabase.from("library_articles").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select("id").single();
  if (error) throw error;
}
export const markLibraryArticleRead = (id, read_at) => status(id, { read_at });
export const setLibraryArticleFavorite = (id, favorited) => status(id, { favorited });
