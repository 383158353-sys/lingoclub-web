import { supabase } from "./supabaseClient";
import { articleSourceUrl } from "./dailyArticlesFormat.js";

const CONTENT_KEYS = ["source_url", "title", "body_en", "author", "outlet", "level", "summary_zh", "analysis"];

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

export function mergeLibraryArticleUpdate(current, patch) {
  if (!current?.id) throw new Error("找不到要更新的文章");
  const next = { ...current };
  for (const key of CONTENT_KEYS) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  const row = validateLibraryArticle(next);
  return { id: current.id, ...row };
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

export async function updateLibraryArticle(id, patch, current) {
  const user = await client();
  const existing = current || await getLibraryArticle(id, { includeDeleted: false });
  if (!existing) throw new Error("文章不存在或无权查看");
  if (existing.user_id && existing.user_id !== user.id) throw new Error("只能编辑自己导入的文章");
  const row = mergeLibraryArticleUpdate(existing, patch);
  const { data, error } = await supabase.from("library_articles")
    .update({
      source_url: row.source_url,
      title: row.title,
      body_en: row.body_en,
      author: row.author,
      outlet: row.outlet,
      level: row.level,
      summary_zh: row.summary_zh,
      analysis: row.analysis,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

const LIST_FIELDS = "id,title,source_url,outlet,level,summary_zh,read_at,favorited,folder,created_at,deleted_at";

export async function listLibraryArticles() {
  const user = await client();
  const { data, error } = await supabase.from("library_articles")
    .select(LIST_FIELDS)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function listDeletedLibraryArticles() {
  const user = await client();
  const { data, error } = await supabase.from("library_articles")
    .select(LIST_FIELDS)
    .eq("user_id", user.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function getLibraryArticle(id, { includeDeleted = true } = {}) {
  await client();
  const { data, error } = await supabase.from("library_articles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || (!includeDeleted && data.deleted_at)) return null;
  return { ...data, rec_date: data.created_at.slice(0, 10) };
}

async function status(id, fields) {
  await client();
  const { error } = await supabase.from("library_articles").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id").single();
  if (error) throw error;
}

export const markLibraryArticleRead = (id, read_at) => status(id, { read_at });
export const setLibraryArticleFavorite = (id, favorited) => status(id, { favorited });
export const setLibraryArticleFolder = (id, folder) => status(id, { folder: folder || "" });

export async function softDeleteLibraryArticles(ids) {
  const user = await client();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("library_articles")
    .update({ deleted_at: now, updated_at: now })
    .eq("user_id", user.id)
    .in("id", list)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  return (data || []).map((row) => row.id);
}

export async function restoreLibraryArticles(ids) {
  const user = await client();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const { data, error } = await supabase.from("library_articles")
    .update({ deleted_at: null, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("id", list)
    .select("id");
  if (error) throw error;
  return (data || []).map((row) => row.id);
}
