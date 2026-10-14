import { groupRecommendationsByDate } from "./dailyRecommendationsFormat.js";

export const groupArticlesByDate = groupRecommendationsByDate;
export const articlePath = (id) => `/articles/${encodeURIComponent(id)}`;
export function articleSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
export function articleDomain(value) {
  const url = articleSourceUrl(value);
  return url ? new URL(url).hostname.replace(/^www\./, "") : "";
}
export function articleParagraphs(body) {
  return typeof body === "string" ? body.split(/\r?\n\s*\r?\n/).map((text) => text.trim()).filter(Boolean) : [];
}
const text = (value) => typeof value === "string" ? value.trim() : "";
export function normalizeAnalysis(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rows = (key, fields) => (Array.isArray(source[key]) ? source[key] : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => Object.fromEntries(fields.map((field) => [field, text(row[field])])))
    .filter((row) => row.en);
  return {
    paragraph_summaries: (Array.isArray(source.paragraph_summaries) ? source.paragraph_summaries : [])
      .filter((row) => row && Number.isInteger(row.index) && row.index > 0 && text(row.zh))
      .map((row) => ({ index: row.index, zh: text(row.zh) })),
    key_vocab: rows("key_vocab", ["en", "zh", "note"]),
    long_sentences: rows("long_sentences", ["en", "structure", "zh"]),
    ielts_expressions: rows("ielts_expressions", ["en", "usage"]),
  };
}
