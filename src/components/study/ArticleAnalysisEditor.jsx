import React from "react";

const VOCAB = [
  ["en", "单词或短语", true],
  ["ipa", "英式音标"],
  ["pos", "词性"],
  ["zh", "本文语境释义"],
  ["collocation", "常用搭配"],
  ["example_en", "英文例句"],
  ["example_zh", "例句中文"],
  ["forms", "词形变化"],
  ["confusion", "易混点"],
];
const SENTENCE = [
  ["en", "原句", true],
  ["zh", "中文翻译"],
  ["structure", "主干"],
  ["clauses", "从句或分词结构"],
  ["reference", "指代关系"],
  ["question_no", "对应题号"],
  ["exam_note", "定位和解题说明"],
];
const EXPR = [
  ["en", "表达", true],
  ["zh", "中文意思"],
  ["usage", "用法/使用方法"],
  ["how", "使用方法"],
  ["example_en", "英文例句"],
  ["example_zh", "例句中文"],
];

function FieldList({ title, rows, fields, onChange }) {
  const update = (index, key, value) => onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  const add = () => onChange([...rows, Object.fromEntries(fields.map(([key]) => [key, ""]))]);
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <button type="button" onClick={add} className="text-sm text-copper">添加</button>
      </div>
      {rows.map((row, index) => (
        <div key={index} className="space-y-2 rounded-2xl border border-border p-3">
          {fields.map(([key, label, required]) => (
            <label key={key} className="block text-xs">
              <span>{label}</span>
              {key === "en" || key === "zh" || key === "example_en" || key === "exam_note" || key === "clauses" ? (
                <textarea required={required} rows={key === "en" ? 2 : 2} value={row[key] || ""} onChange={(e) => update(index, key, e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" />
              ) : (
                <input required={required} value={row[key] || ""} onChange={(e) => update(index, key, e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" />
              )}
            </label>
          ))}
          <button type="button" onClick={() => remove(index)} className="text-xs text-muted-foreground">删除此项</button>
        </div>
      ))}
    </section>
  );
}

export default function ArticleAnalysisEditor({ analysis, onChange }) {
  const set = (key, value) => onChange({ ...analysis, [key]: value });
  const questions = analysis.questions || [];
  const answers = analysis.answer_key || [];
  return (
    <div className="space-y-8">
      <FieldList title="重点词汇与短语" rows={analysis.key_vocab || []} fields={VOCAB} onChange={(rows) => set("key_vocab", rows)} />
      <FieldList title="长难句" rows={analysis.long_sentences || []} fields={SENTENCE} onChange={(rows) => set("long_sentences", rows)} />
      <FieldList title="实用表达" rows={analysis.ielts_expressions || []} fields={EXPR} onChange={(rows) => set("ielts_expressions", rows)} />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">原题说明和题目</h2>
          <button type="button" onClick={() => set("questions", [...questions, { number: "", instruction: "", prompt: "", table_markdown: "" }])} className="text-sm text-copper">添加题目</button>
        </div>
        {questions.map((row, index) => (
          <div key={index} className="space-y-2 rounded-2xl border border-border p-3">
            <label className="block text-xs">题号<input value={row.number || ""} onChange={(e) => set("questions", questions.map((item, i) => (i === index ? { ...item, number: e.target.value } : item)))} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" /></label>
            <label className="block text-xs">原题说明<textarea rows={2} value={row.instruction || ""} onChange={(e) => set("questions", questions.map((item, i) => (i === index ? { ...item, instruction: e.target.value } : item)))} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" /></label>
            <label className="block text-xs">题目<textarea rows={2} value={row.prompt || ""} onChange={(e) => set("questions", questions.map((item, i) => (i === index ? { ...item, prompt: e.target.value } : item)))} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" /></label>
            <label className="block text-xs">表格（Markdown，空格用 {"{9}"} 或 ____ ）<textarea rows={6} value={row.table_markdown || ""} onChange={(e) => set("questions", questions.map((item, i) => (i === index ? { ...item, table_markdown: e.target.value } : item)))} className="mt-1 w-full rounded-xl border border-border bg-card p-2 font-mono text-xs" /></label>
            <button type="button" onClick={() => set("questions", questions.filter((_, i) => i !== index))} className="text-xs text-muted-foreground">删除此题</button>
          </div>
        ))}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">答案解析</h2>
          <button type="button" onClick={() => set("answer_key", [...answers, { number: "", answer: "", explanation: "" }])} className="text-sm text-copper">添加答案</button>
        </div>
        {answers.map((row, index) => (
          <div key={index} className="grid gap-2 rounded-2xl border border-border p-3 md:grid-cols-3">
            <input placeholder="题号" value={row.number || ""} onChange={(e) => set("answer_key", answers.map((item, i) => (i === index ? { ...item, number: e.target.value } : item)))} className="rounded-xl border border-border bg-card p-2 text-sm" />
            <input placeholder="答案" value={row.answer || ""} onChange={(e) => set("answer_key", answers.map((item, i) => (i === index ? { ...item, answer: e.target.value } : item)))} className="rounded-xl border border-border bg-card p-2 text-sm" />
            <input placeholder="解析" value={row.explanation || ""} onChange={(e) => set("answer_key", answers.map((item, i) => (i === index ? { ...item, explanation: e.target.value } : item)))} className="rounded-xl border border-border bg-card p-2 text-sm" />
            <button type="button" onClick={() => set("answer_key", answers.filter((_, i) => i !== index))} className="text-left text-xs text-muted-foreground md:col-span-3">删除</button>
          </div>
        ))}
        <label className="block text-xs">本课易错点（每行一条）
          <textarea rows={4} value={(analysis.pitfalls || []).join("\n")} onChange={(e) => set("pitfalls", e.target.value.split("\n"))} className="mt-1 w-full rounded-xl border border-border bg-card p-2 text-sm" />
        </label>
      </section>
    </div>
  );
}

export function analysisFromEditor(analysis) {
  const questions = (analysis.questions || []).map((row) => ({
    number: row.number,
    instruction: row.instruction,
    prompt: row.prompt,
    table_markdown: row.table_markdown,
  }));
  return {
    paragraph_summaries: analysis.paragraph_summaries || [],
    key_vocab: analysis.key_vocab || [],
    long_sentences: analysis.long_sentences || [],
    ielts_expressions: analysis.ielts_expressions || [],
    questions,
    answer_key: analysis.answer_key || [],
    pitfalls: (analysis.pitfalls || []).map((row) => String(row || "").trim()).filter(Boolean),
  };
}

export function analysisToEditor(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const questions = Array.isArray(source.questions) ? source.questions.map((row) => ({
    number: row.number || "",
    instruction: row.instruction || "",
    prompt: row.prompt || "",
    table_markdown: row.table_markdown || serializeTable(row.table),
  })) : [];
  return {
    paragraph_summaries: Array.isArray(source.paragraph_summaries) ? source.paragraph_summaries : [],
    key_vocab: Array.isArray(source.key_vocab) ? source.key_vocab : [],
    long_sentences: Array.isArray(source.long_sentences) ? source.long_sentences : [],
    ielts_expressions: Array.isArray(source.ielts_expressions) ? source.ielts_expressions : [],
    questions,
    answer_key: Array.isArray(source.answer_key) ? source.answer_key : [],
    pitfalls: Array.isArray(source.pitfalls) ? source.pitfalls.map((row) => (typeof row === "string" ? row : row?.zh || "")).filter(Boolean) : source.pitfalls ? [String(source.pitfalls)] : [],
  };
}

function serializeTable(table) {
  if (!table?.rows?.length) return "";
  return table.rows.map((row) => `| ${row.map((cell) => (cell.blank ? `{${cell.number || ""}}${cell.text || ""}`.replace(/\{\}/, "____") : cell.text || "")).join(" | ")} |`).join("\n");
}
