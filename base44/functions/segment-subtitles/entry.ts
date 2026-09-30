import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 英文台词智能字幕分句（Subtitle Segmentation）
// 两种模式：
//   ① 纯文本 { text }            → 返回无时间戳的字幕块（供独立工具页）
//   ② 带时间戳 { lines:[{text_en,time_start,time_end}] }
//        → 重建词级时间轴，AI 分句后把每个字幕块回填对齐到词级时间轴，
//          保证新的分句边界 time_start/time_end 落在原始时间范围内，
//          不破坏视频播放同步。每个单词都携带时间戳（来自源行时间区间的逐词分配）。

const MAX_CHARS = 6000;

const SCHEMA = {
  type: "object",
  properties: {
    subtitles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          text: { type: "string", description: "字幕块文本；两行时用 \\n 换行" },
          line_count: { type: "number", description: "字幕块行数（1 或 2）" },
          cpl_line1: { type: "number", description: "第一行字符数（含空格与标点）" },
          cpl_line2: { type: "number", description: "第二行字符数；单行块为 0" }
        },
        required: ["id", "text", "line_count", "cpl_line1", "cpl_line2"]
      }
    }
  },
  required: ["subtitles"]
};

const PROMPT = `You are a professional English subtitle editor and linguist. Segment the given continuous English dialogue/script into subtitle cues following STRICT industry formatting and English linguistic rules.

=== 1. FORMATTING CONSTRAINTS (hard limits) ===
- Each cue has at most 1~2 lines. NEVER produce a 3-line cue. Prefer a single line when it is clear and within length.
- Characters Per Line (CPL): each line 32~38 characters (including spaces and punctuation), absolute maximum 42. Never exceed 42.
- Words per cue: ideally 8~14 English words so a viewer can read it in 2~3 seconds.
- When a cue has two lines, separate them with a single newline character \\n.

=== 2. SYNTACTIC BREAK PRIORITY (high → low) ===
Choose break points for new cues and for two-line wrapping by this hierarchy:
1) Sentence punctuation (. ? ! ; —) → must start a NEW independent cue.
   Coordinating conjunctions (and, but, or, so, yet) → break before them.
2) Clause boundaries: relative pronouns (who, which, that) and subordinating conjunctions (because, although, if, when, since, while) → break before them.
3) Non-finite / infinitive phrases: break at the start of an -ing/-ed participle phrase or a "to + Verb" infinitive phrase.
4) Prepositional phrases: break BEFORE the preposition (e.g. "in the morning", "on the table"). Never isolate the preposition at the end of the previous line.

=== 3. NEVER-SPLIT RULES (cognitive units that must stay together) ===
- NEVER split article/determiner + noun ("the / car", "a / beautiful day", "my / friend").
- NEVER split auxiliary/modal + main verb ("has / been", "could / understand", "will / arrive").
- NEVER split phrasal verbs / fixed idioms ("give / up", "look / forward to", "turn / off").
- NEVER leave a dangling preposition or conjunction at a line END (no line may end with: with, at, of, to, for, because, and).
- NEVER leave a single orphan word (widow) as the second line (e.g. a second line of only "it." or "again.").

=== 4. OUTPUT ===
Return ONLY a valid JSON object matching the schema. No commentary, no markdown fences.
- id: sequential integer starting at 1.
- text: the cue text; two lines use \\n.
- line_count: 1 or 2.
- cpl_line1: character count of line 1 (including spaces & punctuation).
- cpl_line2: character count of line 2; 0 when line_count is 1.

CRITICAL: Preserve the original wording, word order, and punctuation EXACTLY — do not rewrite, reword, paraphrase, translate, add, drop, or summarize any word. The output words must match the input words one-to-one in order, only re-grouped into cues and optionally wrapped into two lines.`;

// ===== timecode helpers =====
function tcToSec(raw) {
  if (!raw) return NaN;
  const parts = String(raw).replace(",", ".").trim().split(":").map(parseFloat);
  if (parts.some((p) => Number.isNaN(p))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}
function secToTc(totalSec) {
  if (!Number.isFinite(totalSec)) return "";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec - h * 3600 - m * 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}
// 归一化单词用于匹配：小写 + 去掉非字母数字（保留撇号）
function norm(w) {
  return String(w || "").toLowerCase().replace(/[^a-z0-9']/g, "");
}

// 从源字幕行构建词级时间轴：每行的文本拆词，按字符长度把该行时间区间
// 分配给每个单词 → 每个单词都有 start/end。YouTube 抓取本身已带毫秒级
// 事件时间；粘贴的 SRT/行内时间码也带 cue 时间范围，逐词分配后同样精确。
function buildWordTimeline(lines) {
  const words = [];
  for (const ln of lines) {
    const text = (ln.text_en || "").trim();
    if (!text) continue;
    const start = tcToSec(ln.time_start);
    const end = tcToSec(ln.time_end);
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const totalChars = tokens.reduce((s, t) => s + Math.max(1, t.length), 0) || 1;
      let acc = start;
      for (const tk of tokens) {
        const w = Math.max(0.05, (Math.max(1, tk.length) / totalChars) * (end - start));
        words.push({ word: norm(tk), start: acc, end: acc + w });
        acc += w;
      }
    } else if (Number.isFinite(start)) {
      // 仅有开始时间：每词估算 0.4s
      let acc = start;
      for (const tk of tokens) {
        words.push({ word: norm(tk), start: acc, end: acc + 0.4 });
        acc += 0.4;
      }
    }
    // 无任何时间码的行无法对齐，跳过
  }
  return words;
}

// 把 AI 返回的字幕块回填对齐到词级时间轴：
// 维护指针 p，对每个 cue 在 p 之后找到其首词，然后顺序消费连续匹配的源词，
// 允许跳过少量源词（AI 合并/略去的情况）。cue 的 time_start = 首词 start，
// time_end = 末词 end。p 只前进 → 各 cue 时间戳严格递增，不会跳行/重叠。
function alignCues(subs, words) {
  if (!words.length) return subs;
  let p = 0;
  const out = [];
  for (const cue of subs) {
    const cueTokens = String(cue.text || "").split(/[\s\n]+/).map(norm).filter(Boolean);
    let startIdx = -1, endIdx = -1;
    if (cueTokens.length) {
      // 在 p 之后的小窗口内找首词
      for (let i = p; i < Math.min(words.length, p + 12); i++) {
        if (words[i].word === cueTokens[0]) { startIdx = i; break; }
      }
      if (startIdx === -1) {
        for (let i = p; i < words.length; i++) {
          if (words[i].word === cueTokens[0]) { startIdx = i; break; }
        }
      }
      if (startIdx !== -1) {
        let j = startIdx, k = 0, skips = 0;
        while (j < words.length && k < cueTokens.length && skips < 8) {
          if (words[j].word === cueTokens[k]) { k++; j++; skips = 0; }
          else { j++; skips++; } // 源词在 cue 中缺失（AI 合并）→ 跳过源词
        }
        if (k > 0) endIdx = j - 1;
      }
    }
    const time_start = startIdx !== -1 ? secToTc(words[startIdx].start) : "";
    const time_end = endIdx !== -1 ? secToTc(words[endIdx].end) : (startIdx !== -1 ? secToTc(words[startIdx].end) : "");
    out.push({ ...cue, time_start, time_end });
    if (endIdx !== -1) p = endIdx + 1;
    else if (startIdx !== -1) p = startIdx + 1;
  }
  return out;
}

// 把长文本按句号边界切成 ≤ maxChars 的块，避免单次 InvokeLLM 超限。
// 单句超过 maxChars 时按字符硬切。
function chunkText(text, maxChars) {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    const cand = cur ? cur + " " + s : s;
    if (cand.length > maxChars) {
      if (cur) { chunks.push(cur); cur = ""; }
      if (s.length > maxChars) {
        for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
      } else {
        cur = s;
      }
    } else {
      cur = cand;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// 对整段文本（可能被切块）逐块调用 LLM 分句，合并结果并重新编号。
async function segmentText(base44, text) {
  const chunks = chunkText(text, MAX_CHARS);
  const all = [];
  for (const chunk of chunks) {
    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: PROMPT + "\n\n=== INPUT TEXT ===\n" + chunk,
      response_json_schema: SCHEMA,
    });
    const data = res?.data || res;
    const subs = Array.isArray(data?.subtitles) ? data.subtitles : (Array.isArray(data?.data?.subtitles) ? data.data.subtitles : []);
    all.push(...subs);
  }
  return all.map((s, i) => ({ ...s, id: s.id ?? i + 1 }));
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // ② 带时间戳模式：重建词级时间轴 → AI 分句 → 回填对齐
    const lines = Array.isArray(body?.lines) ? body.lines : null;
    if (lines && lines.length) {
      const fullText = lines.map((l) => (l.text_en || "").trim()).filter(Boolean).join(" ");
      if (!fullText) return Response.json({ error: '文本不能为空' }, { status: 400 });
      const words = buildWordTimeline(lines);
      const subs = await segmentText(base44, fullText);
      const aligned = alignCues(subs, words);
      return Response.json({ subtitles: aligned, count: aligned.length, timed: true });
    }

    // ① 纯文本模式
    const text = (body?.text || "").toString().trim();
    if (!text) return Response.json({ error: '文本不能为空' }, { status: 400 });
    const subs = await segmentText(base44, text);
    return Response.json({ subtitles: subs, count: subs.length });
  } catch (error) {
    return Response.json({ error: error?.message || '分句失败' }, { status: 500 });
  }
}