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
const VOCAB_FIELDS = ["en", "zh", "note", "ipa", "pos", "collocation", "example_en", "example_zh", "forms", "confusion"];
const SENTENCE_FIELDS = ["en", "zh", "structure", "clauses", "reference", "question_no", "exam_note"];
const EXPR_FIELDS = ["en", "usage", "zh", "how", "example_en", "example_zh"];
const BOILERPLATE = /PDF\s*第\s*\d+\s*页|课堂新词|收藏不代表掌握|原文就在本篇正文上方|原文位置为PDF/;

export function scrubAnalysisRemark(value) {
  const cleaned = text(value)
    .replace(/PDF\s*第\s*\d+\s*页[^\s；。]*[；。]?\s*/g, "")
    .replace(/原文就在本篇正文上方[；。]?\s*/g, "")
    .replace(/课堂新词\/?复习项[；，,]?\s*/g, "")
    .replace(/收藏不代表掌握。?\s*/g, "")
    .trim();
  return !cleaned || BOILERPLATE.test(cleaned) ? "" : cleaned;
}

function rows(source, key, fields) {
  return (Array.isArray(source[key]) ? source[key] : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => Object.fromEntries(fields.map((field) => [field, field === "note" ? scrubAnalysisRemark(row[field]) : text(row[field])])))
    .filter((row) => row.en);
}

function cell(value) {
  if (value == null) return { text: "" };
  if (typeof value === "string" || typeof value === "number") {
    const raw = String(value);
    const blank = raw.match(/^\{(\d+[a-z]?)\}\s*(.*)$/i) || raw.match(/^(_{2,}|\u3000+)$/);
    if (blank && blank[1] && !blank[0].startsWith("_") && blank[0][0] !== "\u3000") {
      return { text: text(blank[2]), blank: true, number: blank[1] };
    }
    if (/^_{2,}$/.test(raw.trim()) || raw.trim() === "\u3000") return { text: "", blank: true };
    return { text: text(raw) };
  }
  if (typeof value !== "object" || Array.isArray(value)) return { text: "" };
  const number = text(value.number);
  const colspan = Number.parseInt(value.colspan, 10);
  const rowspan = Number.parseInt(value.rowspan, 10);
  return {
    text: text(value.text),
    ...(value.blank || number ? { blank: true } : {}),
    ...(number ? { number } : {}),
    ...(colspan > 1 ? { colspan } : {}),
    ...(rowspan > 1 ? { rowspan } : {}),
  };
}

export function normalizeTable(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return parseMarkdownTable(raw);
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const sourceRows = Array.isArray(raw.rows) ? raw.rows : [];
  const rows = sourceRows
    .map((row) => {
      if (typeof row === "string") return row.split("|").map((part) => cell(part));
      if (!Array.isArray(row)) return [];
      return row.map(cell);
    })
    .filter((row) => row.some((item) => item.text || item.blank || item.number));
  if (!rows.length) return null;
  return { caption: text(raw.caption), rows };
}

export function parseMarkdownTable(markdown) {
  const lines = String(markdown || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => line.includes("|"))
    .filter((line) => !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(line));
  const rows = lines.map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((part) => cell(part.trim())));
  return rows.length ? { caption: "", rows } : null;
}

function normalizeQuestions(source) {
  const list = Array.isArray(source.questions) ? source.questions : [];
  return list
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({
      number: text(row.number),
      instruction: text(row.instruction),
      prompt: text(row.prompt),
      table: normalizeTable(row.table || row.table_markdown),
    }))
    .filter((row) => row.instruction || row.prompt || row.table);
}

function normalizeAnswers(source) {
  const items = (Array.isArray(source.answer_key) ? source.answer_key : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => ({ number: text(row.number), answer: text(row.answer), explanation: text(row.explanation) }))
    .filter((row) => row.number || row.answer || row.explanation);
  const pitfalls = Array.isArray(source.pitfalls)
    ? source.pitfalls.map((row) => (typeof row === "string" ? text(row) : text(row?.zh))).filter(Boolean)
    : text(source.pitfalls) ? [text(source.pitfalls)] : [];
  return { items, pitfalls };
}

export function normalizeAnalysis(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const answers = normalizeAnswers(source);
  return {
    paragraph_summaries: (Array.isArray(source.paragraph_summaries) ? source.paragraph_summaries : [])
      .filter((row) => row && Number.isInteger(row.index) && row.index > 0 && text(row.zh))
      .map((row) => ({ index: row.index, zh: text(row.zh) })),
    key_vocab: rows(source, "key_vocab", VOCAB_FIELDS),
    long_sentences: rows(source, "long_sentences", SENTENCE_FIELDS),
    ielts_expressions: rows(source, "ielts_expressions", EXPR_FIELDS),
    questions: normalizeQuestions(source),
    answer_key: answers.items,
    pitfalls: answers.pitfalls,
  };
}

export function analysisHasClassroomNotes(analysis) {
  return Boolean(analysis?.questions?.length || analysis?.answer_key?.length || analysis?.pitfalls?.length
    || analysis?.key_vocab?.length || analysis?.long_sentences?.length || analysis?.ielts_expressions?.length);
}

export function vocabDisplayFields(row) {
  return [
    ["ipa", row.ipa],
    ["pos", row.pos],
    ["zh", row.zh],
    ["collocation", row.collocation],
    ["example_en", row.example_en],
    ["example_zh", row.example_zh],
    ["forms", row.forms],
    ["confusion", row.confusion],
    ["note", row.note],
  ].filter(([, value]) => value);
}

export function sentenceDisplayFields(row) {
  return [
    ["zh", row.zh],
    ["structure", row.structure],
    ["clauses", row.clauses],
    ["reference", row.reference],
    ["exam_note", row.exam_note],
  ].filter(([, value]) => value);
}

export function expressionDisplayFields(row) {
  return [
    ["zh", row.zh],
    ["usage", row.usage],
    ["how", row.how],
    ["example_en", row.example_en],
    ["example_zh", row.example_zh],
  ].filter(([, value]) => value);
}
