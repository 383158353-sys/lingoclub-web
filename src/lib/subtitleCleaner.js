// 统一字幕文本清洗：去除行首本地化时间戳前缀（"1分钟3秒钟""59秒钟""1 min 30 sec"等）
// 及其后的分隔符（- ♪ 空格等），只保留纯净台词文本。
// 在所有字幕导入入口（书签解码、API 抓取、粘贴解析）统一调用，确保无论数据来源
// 是否已清洗，进入数据库前 text_en 都是干净的。
import { fromSecPrecise } from "./timecode.js";

const LOC_TC_PREFIX_RX =
  /^\s*(?:\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?)\s*(?:\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))?|\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))\s*[-–—:♪♫♩♬\s]*/i;

export function cleanSubtitleText(text) {
  if (!text) return "";
  return String(text)
    .replace(LOC_TC_PREFIX_RX, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Legacy sentence merger. The watch / 精读 list must not call this.
 * Player caption windows are the list rows (see captionDisplayCues.js).
 * Merging flashes or cutting them by length drifts away from what is on screen
 * and rewrites cue timings. Kept so the old timing math stays regression-locked.
 *
 * 三阶段字幕分句：
 *  ① 预切分：将含句中句号(.!?)的片段拆成独立行。
 *  ② 合并：将碎片化的短片段按标点/时间轴合并为完整句。
 *  ③ 拆长句：合并后仍过长的行，在逗号或连接词处拆分。
 */
export function mergeFragments(subs, opts = {}) {
  if (!Array.isArray(subs) || subs.length === 0) return [];

  const maxLen = opts.maxLen || 220;        // 合并上限：超过则不再继续合并
  const splitLen = opts.splitLen || 90;     // 拆分阈值：超过则在逗号/连词处拆为半句
  const maxGapSec = opts.maxGapSec ?? 3.0;  // 时间间隔上限

  const genId = () => `mf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const toSec = (tc) => {
    if (!tc) return NaN;
    const parts = String(tc).replace(",", ".").trim().split(":").map(parseFloat);
    if (parts.some((p) => Number.isNaN(p))) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return NaN;
  };

  const fmtTime = fromSecPrecise;

  const endsSentence = (text) =>
    /[.!?]["'\u201d\u2019)]?$/.test((text || "").trim());

  // 预处理：补全缺失的 time_end（用下一条的 time_start 填充），
  // 使 distributeTime 的比例分配能覆盖所有有 time_start 的行。
  const filled = subs.map((s) => ({ ...s }));
  for (let i = 0; i < filled.length; i++) {
    const end = toSec(filled[i].time_end);
    if (Number.isFinite(end)) continue;
    for (let j = i + 1; j < filled.length; j++) {
      const nextStart = toSec(filled[j].time_start);
      if (Number.isFinite(nextStart)) {
        filled[i].time_end = fmtTime(nextStart);
        break;
      }
    }
  }

  // 按词数比例将时间区间分配给拆分后的各行，保证每行有唯一且准确的 time_start。
  // 用词数而非字符数：语速以"词/分钟"衡量更稳定，字符数会因单词长短差异导致
  // 短词多的句子被分配过多时间。句末标点(.!?)加 0.4 词停顿权重模拟自然语速。
  const wordCount = (text) => (text || "").trim().split(/\s+/).filter(Boolean).length;
  const partWeight = (p) => {
    const wc = wordCount(p.text_en);
    const hasStop = /[.!?]["'\u201d\u2019)]?$/.test((p.text_en || "").trim());
    return Math.max(0.5, wc) + (hasStop ? 0.4 : 0);
  };

  const distributeTime = (parts, origStart, origEnd) => {
    const start = toSec(origStart);
    const end = toSec(origEnd);

    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const totalW = parts.reduce((sum, p) => sum + partWeight(p), 0) || 1;
      let cur = start;
      return parts.map((p, i) => {
        const dur = (end - start) * (partWeight(p) / totalW);
        const partEnd = i === parts.length - 1 ? end : cur + dur;
        const result = { ...p, time_start: fmtTime(cur), time_end: fmtTime(partEnd) };
        cur = partEnd;
        return result;
      });
    }

    // 仅有 time_start：按词数估算每行时长（每词约 0.4s），至少 0.5s
    if (Number.isFinite(start)) {
      let cur = start;
      return parts.map((p) => {
        const dur = Math.max(0.5, wordCount(p.text_en) * 0.4);
        const result = { ...p, time_start: fmtTime(cur), time_end: fmtTime(cur + dur) };
        cur += dur;
        return result;
      });
    }

    return parts; // 无时间码
  };

  // ===== Phase 1: 预切分 — 含句中句号的片段拆成多行 =====
  const splitBySentence = (text) => {
    const t = (text || "").trim();
    if (!t) return [];
    const matches = t.match(/[^.!?]*[.!?]+["'\u201d\u2019)]*\s*/g);
    if (!matches) return [t];
    const result = matches.map((s) => s.trim()).filter(Boolean);
    const leftover = t.slice(matches.join("").length).trim();
    if (leftover) result.push(leftover);
    return result;
  };

  // 片段内拆出的句子：按「前面有几个词」在片段的真实发声区间内定位起点。
  // 真实区间 = [本片段起点, min(本片段终点, 下一片段起点)]——滚动式自动字幕的
  // time_end 会和后面 1~2 条重叠，若按 time_end 平均分配，句中后半句会被算晚
  // 最多 4s+（RiO6yDxDui4 实测 212/815 行晚于其所在片段的发声区间）。
  const splitInCue = (splitSubs, sub, nextSub) => {
    const start = toSec(sub.time_start);
    if (!Number.isFinite(start)) return splitSubs;
    let end = toSec(sub.time_end);
    const nextStart = nextSub ? toSec(nextSub.time_start) : NaN;
    if (Number.isFinite(nextStart) && nextStart > start && (!Number.isFinite(end) || nextStart < end)) end = nextStart;
    if (!(end > start)) return distributeTime(splitSubs, sub.time_start, sub.time_end);
    const counts = splitSubs.map((p) => Math.max(1, wordCount(p.text_en)));
    const total = counts.reduce((a, b) => a + b, 0);
    let before = 0;
    const starts = counts.map((c) => { const t = start + (end - start) * (before / total); before += c; return t; });
    return splitSubs.map((p, i) => ({
      ...p,
      time_start: fmtTime(starts[i]),
      time_end: i + 1 < starts.length ? fmtTime(starts[i + 1]) : sub.time_end,
    }));
  };

  const preSplit = [];
  for (const [subIndex, sub] of filled.entries()) {
    const parts = splitBySentence(sub.text_en);
    if (parts.length <= 1) { preSplit.push(sub); continue; }
    const splitSubs = parts.map((p, i) => ({ ...sub, text_en: p, id: i === 0 ? sub.id : genId() }));
    preSplit.push(...splitInCue(splitSubs, sub, filled[subIndex + 1]));
  }

  // ===== Phase 2: 合并碎片 =====
  // anchorsOf 记录合并行里每个原始片段的起始字符位置与原始时间轴，Phase 3 拆分时
  // 用它还原真实 time_start，而不是在整段（可能 20s+）上按词数平均分配。
  const anchorsOf = new WeakMap();
  const merged = [];
  let cur = null;

  // 滚动式自动字幕的片段互相重叠：锚点结束时间截到下一片段起点，避免尾部半句被算晚。
  const anchorEnd = (i) => {
    const end = toSec(preSplit[i].time_end);
    const next = i + 1 < preSplit.length ? toSec(preSplit[i + 1].time_start) : NaN;
    return Number.isFinite(next) && (!Number.isFinite(end) || next < end) ? next : end;
  };

  for (const [subIndex, sub] of preSplit.entries()) {
    if (!cur) {
      cur = { ...sub, text_en: (sub.text_en || "").trim() };
      anchorsOf.set(cur, [{ at: 0, start: toSec(sub.time_start), end: anchorEnd(subIndex) }]);
      continue;
    }
    const curText = cur.text_en || "";
    const nextText = (sub.text_en || "").trim();
    const combinedLen = curText.length + 1 + nextText.length;

    const curEnd = toSec(cur.time_end);
    const nextStart = toSec(sub.time_start);
    const gap = (Number.isFinite(curEnd) && Number.isFinite(nextStart)) ? nextStart - curEnd : 0;

    const shouldMerge = !endsSentence(curText) && gap <= maxGapSec && combinedLen <= maxLen;

    if (shouldMerge) {
      anchorsOf.get(cur).push({ at: curText.length + 1, start: nextStart, end: anchorEnd(subIndex) });
      cur.text_en = (curText + " " + nextText).trim();
      if (sub.time_end) cur.time_end = sub.time_end;
      if (sub.text_zh) cur.text_zh = cur.text_zh ? (cur.text_zh + " " + sub.text_zh).trim() : sub.text_zh;
    } else {
      merged.push(cur);
      cur = { ...sub, text_en: nextText };
      anchorsOf.set(cur, [{ at: 0, start: nextStart, end: anchorEnd(subIndex) }]);
    }
  }
  if (cur) merged.push(cur);

  // ===== Phase 3: 拆长句 =====
  // 规则：句号(.!?)已在 Phase 1 强制断句；此处仅处理仍过长的句子，
  // 在逗号 / 连接词 / 大写主语前 有条件地断开（仅当句子超过 splitLen 时）。
  const CONJ_RX = /\s+(?:and|but|because|so|or|however|although|though|while|then|which|that|therefore|moreover|furthermore|meanwhile|whereas|since|until|unless)\s+/gi;

  const splitLong = (text) => {
    const t = (text || "").trim();
    if (t.length <= splitLen) return [t];

    // 1) 优先在逗号处拆分（逗号留在前半句末尾）
    let idx = t.lastIndexOf(",", splitLen);
    if (idx <= 20) idx = -1;

    // 2) 其次在连接词处拆分（连接词归属后半句开头）
    if (idx === -1) {
      let m, lastIdx = -1;
      CONJ_RX.lastIndex = 0;
      while ((m = CONJ_RX.exec(t)) !== null) {
        if (m.index > splitLen) break;
        if (m.index >= 20) lastIdx = m.index;
      }
      if (lastIdx >= 20) idx = lastIdx;
    }

    // 3) 其次在大写词（主语/新句开头）前拆分
    if (idx === -1) {
      const window = t.slice(0, splitLen);
      const re = /\s(?=[A-Z])/g;
      let m, capIdx = -1;
      while ((m = re.exec(window)) !== null) {
        if (m.index >= 20) capIdx = m.index;
      }
      if (capIdx >= 20) idx = capIdx;
    }

    // 4) 兜底：splitLen 内最近的空格
    if (idx === -1) idx = t.lastIndexOf(" ", splitLen);
    if (idx <= 20) return [t];

    return [t.slice(0, idx).trim(), ...splitLong(t.slice(idx).trim().replace(/^[,;:]\s*/, ""))];
  };

  // 按原始片段锚点给拆分后的半句定时：半句首字符落在哪个原始片段里，就取该片段
  // 的真实起点（片段内部再按字符比例插值，误差不超过单个片段的时长）。
  const anchorTime = (parts, s, anchors) => {
    if (!anchors || anchors.length < 2 || anchors.some((a) => !Number.isFinite(a.start))) return null;
    const text = s.text_en || "";
    const mergedEnd = toSec(s.time_end);
    const timeAt = (offset) => {
      let i = 0;
      while (i + 1 < anchors.length && anchors[i + 1].at <= offset) i++;
      const a = anchors[i];
      const nextAt = i + 1 < anchors.length ? anchors[i + 1].at : text.length;
      let spanEnd = i + 1 < anchors.length ? anchors[i + 1].start : (Number.isFinite(a.end) ? a.end : a.start);
      if (Number.isFinite(a.end) && a.end < spanEnd) spanEnd = a.end; // 滚动字幕重叠时取较早者
      if (!(spanEnd > a.start) || nextAt <= a.at) return a.start;
      return a.start + (spanEnd - a.start) * Math.min(1, (offset - a.at) / (nextAt - a.at));
    };
    let pos = 0;
    const starts = parts.map((p) => {
      const idx = text.indexOf(p.text_en, pos);
      const offset = idx >= 0 ? idx : pos;
      pos = offset + (p.text_en || "").length;
      return timeAt(offset);
    });
    return parts.map((p, i) => {
      const end = i + 1 < parts.length ? starts[i + 1] : (Number.isFinite(mergedEnd) ? mergedEnd : starts[i] + 1);
      return { ...p, time_start: fmtTime(starts[i]), time_end: fmtTime(Math.max(starts[i], end)) };
    });
  };

  const result = [];
  for (const s of merged) {
    const parts = splitLong(s.text_en);
    if (parts.length <= 1) { result.push(s); continue; }
    const splitSubs = parts.map((p, i) => ({ ...s, text_en: p, id: i === 0 ? s.id : genId() }));
    const anchored = anchorTime(splitSubs, s, anchorsOf.get(s));
    result.push(...(anchored || distributeTime(splitSubs, s.time_start, s.time_end)));
  }

  const ordered = result.map((s, i) => ({ ...s, order: i + 1 }));

  // ===== 最终保障：确保每一行都有唯一且递增的 time_start =====
  // 1) 缺 time_start 的行：用前后邻居插值
  for (let i = 0; i < ordered.length; i++) {
    if (!Number.isNaN(toSec(ordered[i].time_start))) continue;
    let prevTs = null;
    for (let j = i - 1; j >= 0; j--) {
      const ts = toSec(ordered[j].time_start);
      if (!Number.isNaN(ts)) { prevTs = ts; break; }
    }
    let nextTs = null;
    for (let j = i + 1; j < ordered.length; j++) {
      const ts = toSec(ordered[j].time_start);
      if (!Number.isNaN(ts)) { nextTs = ts; break; }
    }
    if (prevTs != null && nextTs != null) {
      ordered[i].time_start = fmtTime(prevTs + (nextTs - prevTs) / 2);
      if (!ordered[i].time_end || Number.isNaN(toSec(ordered[i].time_end))) ordered[i].time_end = fmtTime(nextTs);
    } else if (prevTs != null) {
      ordered[i].time_start = fmtTime(prevTs + 0.5);
      ordered[i].time_end = fmtTime(prevTs + 1.5);
    } else if (nextTs != null) {
      ordered[i].time_start = fmtTime(Math.max(0, nextTs - 1));
      ordered[i].time_end = fmtTime(nextTs);
    }
  }

  // 2) 确保每行 time_start 严格递增（防止重复值导致高亮跳行）
  for (let i = 1; i < ordered.length; i++) {
    const cur = toSec(ordered[i].time_start);
    const prev = toSec(ordered[i - 1].time_start);
    if (Number.isFinite(cur) && Number.isFinite(prev) && cur <= prev) {
      const offset = prev + 0.1;
      const end = toSec(ordered[i].time_end);
      ordered[i].time_start = fmtTime(offset);
      if (!Number.isFinite(end) || end <= offset) ordered[i].time_end = fmtTime(offset + 0.5);
    }
  }

  return ordered;
}