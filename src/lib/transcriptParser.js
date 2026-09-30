import { fromSec, fromSecPrecise } from "@/lib/timecode";

// 把粘贴/上传的字幕文本统一解析为 {text_en, speaker, time_start, time_end, order}。
// 支持：SRT/WebVTT cue、行内行首时间码、「时间码独占一行+下一行文本」、
// 「发言人 N / Speaker N」访谈稿（按文字长度分配时间戳）、纯文本（按句切分）。
const TC = "\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d{1,3})?";
const RANGE = new RegExp(`(${TC})\\s*-->\\s*(${TC})`);
const LEAD = new RegExp(`^\\s*[\\[\\(\\u3010\\u300c]?\\s*(${TC})\\s*[\\]\\)\\u3011\\u300d]?\\s+(.*)$`, "s");
const PURE_TC = new RegExp(`^\\s*[\\[\\(\\u3010\\u300c]?\\s*(${TC})\\s*[\\]\\)\\u3011\\u300d]?\\s*$`);
const SPEAKER_HEADER = /^\s*(发言人|Speaker|Narrator|Host|主持人|旁白)\s*0?(\d+)\s*[:：]?\s*$/i;

function splitSentences(s) {
  return String(s)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length > 0);
}

function distributeByLength(sents, totalSec) {
  const total = sents.reduce((s, x) => s + x.text.length, 0) || 1;
  let acc = 0;
  return sents.map((x, i) => {
    const start = (acc / total) * totalSec;
    acc += x.text.length;
    const end = (acc / total) * totalSec;
    return {
      text_en: x.text,
      speaker: x.speaker || "",
      time_start: fromSecPrecise(start),
      time_end: fromSecPrecise(Math.max(0, end - 0.1)),
      order: i + 1,
    };
  });
}

function toSec2(raw) {
  if (!raw) return NaN;
  const parts = String(raw).replace(",", ".").trim().split(":").map(parseFloat);
  if (parts.some((p) => Number.isNaN(p))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}

// YouTube 转录稿里的音效/噪声标记：[APPLAUSE] [CHEERING] [LAUGHTER] [MUSIC] 等整段方/圆括号包裹的占位
// 覆盖带后缀词的变体（[Music plays] [Applause fades] [Crowd laughing]），
// 也覆盖音符 ♪ ♫、HTML/WebVTT 行内标签 <i></i><b></b><c.color></c>、
// 以及行首 ">>"、"- " 这类 YouTube 自动转录的说话人标记。
const SOUND_FX_RX = /\[(?:APPLAUSE|APPLAUSE\s+FADES?|APPLAUSE\s+CONTINUES|CONTINUED\s+APPLAUSE|CHEERING|CHEERS|LAUGHTER|LAUGHING|LAUGH|MUSIC|MUSIC\s+PLAYS?|MUSIC\s+FADES?|CROWD(?:\s+NOISE|\s+LAUGHING)?|INDISTINCT|INAUDIBLE|NOISE|SOUND(?:S|\s+\w+)?|BACKGROUND|FAINT\w*|BEEPING|MUMBLING|SIGH\w*|FOREIGN|SILENCE|GASP\w*|AUDIENCE)\]/gi;
const SOUND_FX_RX_PAREN = /\((?:APPLAUSE|CHEERING|LAUGHTER|LAUGHING|MUSIC|INDISTINCT|INAUDIBLE|NOISE|SOUND|CROWD\s+NOISE|FOREIGN|SIGH\w*|GASP\w*)\)/gi;
const MUSIC_NOTE_RX = /[♪♫♩♬\u2669-\u266F]/g;
const VTT_TAG_RX = /<\/?[a-z][^>]*>/gi;
// YouTube 转录稿行首的章节标题：第 N 章 / Chapter N / Section N / Part N（整行删）
const CHAPTER_LINE_RX = /^\s*(?:第\s*\d+\s*[章节回]|Chapter\s+\d+|Section\s+\d+|Part\s+\d+)\b/i;
// 整行噪声：字幕头 / Amara 署名 / 纯 URL / 纯 ">>" 标记 / 纯音符行
const NOISE_LINE_RX = /^\s*(?:Transcript\s*:?\s*$|Subtitles?\s+by\s.*$|Amara\.org\b.*$|>>\s*$|[\u2669-\u266F\s]+)$/i;
const URL_LINE_RX = /^\s*https?:\/\/\S+\s*$/i;
// 整行就是本地化时间码（"7分钟52秒钟""252秒""4分钟""4 min 52 sec"）→ 删整行
const LOC_TC_LINE_RX = /^\s*\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?|hrs?|hours?)?(?:\s*\d+\s*)?(?:秒(?:钟)?|sec(?:ond)?s?)\s*$/i;
// 行首本地化时间戳前缀："1分钟3秒钟- ""1分15秒♪ ""30秒钟 ""1 min 30 sec " 等
// 后面可能跟分隔符（- – ♪ ♫ 空格），整段剥掉只保留台词文本
const LOC_TC_PREFIX_RX = /^\s*(?:\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?)\s*(?:\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))?|\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))\s*[-–—:♪♫♩♬\s]*/i;

function stripChapterHeadingLine(line) {
  if (CHAPTER_LINE_RX.test(line)) return "";
  if (NOISE_LINE_RX.test(line)) return "";
  if (URL_LINE_RX.test(line)) return "";
  if (LOC_TC_LINE_RX.test(line)) return "";
  return line;
}

function clean(s) {
  return String(s)
    .replace(/<s\b[^>]*>/gi, "s")
    .replace(/<\/s\b[^>]*>/gi, "")
    .replace(VTT_TAG_RX, "")
    .replace(MUSIC_NOTE_RX, "")
    .replace(SOUND_FX_RX, " ")
    .replace(SOUND_FX_RX_PAREN, " ")
    .replace(LOC_TC_PREFIX_RX, "")
    .replace(/(^|\s)>+\s*/g, "$1")
    .replace(/^\s*-\s+/, "")
    .replace(/^\s*\d+\s*$/m, "")
    .replace(/align:\w+|position:\d+%|line:\d+%/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function padToSrt(tc) {
  const [main, ms] = String(tc).replace(",", ".").trim().split(/[.,]/);
  const parts = main.split(":").map((p) => p.padStart(2, "0"));
  let h, m, sec;
  if (parts.length === 3) { [h, m, sec] = parts; }
  else if (parts.length === 2) { h = "00"; [m, sec] = parts; }
  else { h = "00"; m = "00"; sec = parts[0]; }
  return `${h}:${m}:${sec},${(ms || "000").padEnd(3, "0")}`;
}

export function parseTranscript(raw, totalSec = 1058) {
  let text = String(raw || "").replace(/\r/g, "");
  // 先移除整行的章节标题（第 N 章 / Chapter N）—— YouTube 转录稿会插入这些
  text = text.split("\n").map(stripChapterHeadingLine).join("\n");
  // YouTube 不同账号语言下会把时间码本地化为 "7分钟52秒钟""7分52秒""252秒""4分钟"
  // "4 min 52 sec""4 minutes 52 seconds" 等，且常直接叠加在标准时间码后，
  // 例如 "0:000秒钟STEVE..."。先把"紧贴标准时间码"的本地化描述剥掉（保留
  // 标准时间码本身），整行纯本地化时间码由 stripChapterHeadingLine 删除。
  text = text.replace(/(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*(?:\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?|hrs?|hours?))?\s*(?:\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))?/gi, "$1 ");

  // YouTube 单段粘贴时多个 cue 会被挤在一行（无换行）。把每个时间码前插入换行，
  // 让每个 cue 走独立行；含 "-->"（SRT/WebVTT）的不拆，以免破坏时间范围。
  if (!text.includes("-->")) {
    text = text.replace(/\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/g, "\n$1");
  }

  // 0) 预处理：纯时间码独占一行 + 下一行文本 → 标准 SRT cue
  if (!text.includes("-->")) {
    const rawLines = text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const pureTcIdx = rawLines.findIndex((l) => PURE_TC.test(l) && !Number.isNaN(toSec2(l.match(PURE_TC)[1])));
    if (pureTcIdx !== -1) {
      // 当行内已存在"时间码 + 文本"（LEAD 命中）时，说明是混合格式，由 step2
      // 更准确处理；这里只在全部是"纯 TC 行 + 独立 body 行"时才走 SRT 重建。
      const hasLeadWithBody = rawLines.some((l) => {
        if (PURE_TC.test(l)) return false;
        const m = l.match(LEAD);
        return m && !Number.isNaN(toSec2(m[1])) && m[2].trim().length > 0;
      });
      if (!hasLeadWithBody) {
        const cues = [];
        for (let i = 0; i < rawLines.length; i++) {
          const pm = rawLines[i].match(PURE_TC);
          if (!pm || Number.isNaN(toSec2(pm[1]))) continue;
          const start = pm[1];
          const bodyLines = [];
          for (let j = i + 1; j < rawLines.length; j++) {
            if (PURE_TC.test(rawLines[j]) && !Number.isNaN(toSec2(rawLines[j].match(PURE_TC)[1]))) break;
            bodyLines.push(rawLines[j]);
          }
          if (bodyLines.length) cues.push({ start, text: bodyLines.join(" ") });
        }
        if (cues.length) {
          const srt = cues.map((c, idx) => {
            const next = cues[idx + 1];
            const end = next ? next.start : null;
            const endStr = end ? padToSrt(end) : (() => {
              const s = toSec2(c.start) + 3;
              return padToSrt(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
            })();
            return `${idx + 1}\n${padToSrt(c.start)} --> ${endStr}\n${c.text}`;
          }).join("\n\n");
          text = srt;
        }
      }
    }
  }

  // 1) SRT / WebVTT block cues
  if (text.includes("-->")) {
    const cues = [];
    for (const block of text.split(/\n\s*\n/)) {
      const m = block.match(RANGE);
      if (!m) continue;
      const a = toSec2(m[1]);
      const b = toSec2(m[2]);
      const body = clean(block.slice(m.index + m[0].length));
      if (!body) continue;
      cues.push({ text_en: body, time_start: fromSecPrecise(a), time_end: fromSecPrecise(b), order: Math.floor(a) || cues.length + 1 });
    }
    if (cues.length) return cues;
  }

  // 2) 行内 / 行首时间码 + 纯时间码行
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((l) => !/^WEBVTT/i.test(l) && !/^NOTE\b/i.test(l) && !/^\d+$/.test(l));
  const items = [];
  let speaker = "";
  let sawHeader = false;
  let pendingTs = null;
  for (const ln of lines) {
    if (SPEAKER_HEADER.test(ln)) { sawHeader = true; speaker = ln.replace(/[:：]\s*$/, "").trim(); continue; }
    const pm = ln.match(PURE_TC);
    if (pm && !Number.isNaN(toSec2(pm[1]))) { pendingTs = toSec2(pm[1]); continue; }
    let ts = null, body = ln;
    const m = ln.match(LEAD);
    if (m && !Number.isNaN(toSec2(m[1])) && m[2].trim().length > 0) { ts = toSec2(m[1]); body = m[2].trim(); }
    else if (pendingTs != null) { ts = pendingTs; pendingTs = null; }
    if (body) items.push({ speaker, ts, text: clean(body) });
  }
  const anyTs = items.some((it) => it.ts != null);

  if (anyTs) {
    const blocks = [];
    for (const it of items) {
      if (it.ts != null) blocks.push({ ts: it.ts, text: it.text, speaker: it.speaker });
      else if (blocks.length) blocks[blocks.length - 1].text += " " + it.text;
      else blocks.push({ ts: null, text: it.text, speaker: it.speaker });
    }
    const out = [];
    let order = 0;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (!b.text.trim()) continue;
      if (b.ts == null) { order++; out.push({ speaker: sawHeader ? b.speaker : "", text_en: b.text.trim(), time_start: "", time_end: "", order }); continue; }
      let endTs = null;
      for (let j = bi + 1; j < blocks.length; j++) {
        if (blocks[j].ts != null) { endTs = blocks[j].ts; break; }
      }
      order++;
      out.push({
        speaker: sawHeader ? b.speaker : "",
        text_en: b.text.trim(),
        time_start: fromSecPrecise(b.ts),
        time_end: endTs != null ? fromSecPrecise(Math.max(0, endTs - 0.1)) : "",
        order,
      });
    }
    return out;
  }

  // 3) 发言人标注、无时间码 → 按句切分并按文字长度分配时间戳
  if (sawHeader && items.length) {
    const sents = [];
    for (const it of items) for (const st of splitSentences(it.text)) sents.push({ speaker: it.speaker, text: st });
    return distributeByLength(sents, totalSec);
  }

  // 4) 纯文本 → 按句切分，无时间戳
  return splitSentences(text).map((t, i) => ({ text_en: t, speaker: "", time_start: "", time_end: "", order: i + 1 }));
}