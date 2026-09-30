// 浏览器端 B站 CC 字幕抓取器
// ------------------------------------------------------------
// 与 YouTube 客户端同源思路：Base44 后端落数据中心 IP、B 站 API 直接跨域
// 大概率被拒；用户浏览器走住宅 IP + CORS 代理可达公开端点。流程：
//   1) /x/web-interface/view?bvid=BV → aid + cid（多 P 走 pages[p-1].cid）
//   2) /x/player/v2?aid&cid           → subtitle.subtitles[]（CC 字幕轨列表）
//   3) 优先选英文 CC（lan=en / ai-en），抓 subtitle_url JSON 含 from/to/content
//   4) 写入 Subtitle，与 YouTube 路径产出一致：text_en + time_start + time_end
// B站官方 CC 由 UP 主或 B站 AI 自动生成；英语学习/影视类 UP 多同时上传英文
// 字幕轨——这正与本 App「逐句精读」需求吻合。若该视频未配英文 CC，则抛错并
// 引导用户改走「上传音频 → Whisper 转写」或继续粘贴外部转写到批量导入框。
import { base44 } from "@/api/base44Client";

// 公共 CORS 代发服务（与 YouTube 客户端共用同套；B站 API 普遍拒直接跨域）。
// 解析失败或非零 code 就轮到下一家。
const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://proxy.cors.sh/${u}`,
];

async function fetchProxied(url) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 10000);
      let res;
      try {
        res = await fetch(wrap(url), { signal: ctrl.signal, headers: { Accept: "application/json, */*" } });
      } finally { clearTimeout(id); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("网络请求失败");
}

async function fetchJson(url) {
  const text = await fetchProxied(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`B站接口返回不是合法 JSON（或代理被风控）：${(text || "").slice(0, 80)}`);
  }
}

export function extractBilibiliId(url) {
  if (!url) return null;
  const m = String(url).match(/bilibili\.com\/video\/(BV[\w]+|av\d+)/i);
  if (!m) return null;
  const token = m[1];
  return token.toLowerCase().startsWith("av")
    ? { type: "aid", id: token.replace(/^av/i, "") }
    : { type: "bvid", id: token };
}

export function isBilibiliUrl(url) {
  return /bilibili\.com\/video\/(BV|av)|b23\.tv|player\.bilibili\.com\/player/i.test(url || "");
}

function extractPageParam(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams.get("p");
    return p ? Math.max(1, parseInt(p, 10) || 1) : 1;
  } catch { return 1; }
}

// 保留毫秒精度：B站 CC 字幕 from/to 为浮点秒，截断为整数秒会导致
// 多条字幕共享同一 time_start，分句后时间轴错乱。
function secToTimecode(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

// 视频元信息：拿 aid + cid（多 P 时按 p 取对应分 P 的 cid）
async function getAidCid(id, page, url) {
  const viewUrl = id.type === "aid"
    ? `https://api.bilibili.com/x/web-interface/view?aid=${id.id}`
    : `https://api.bilibili.com/x/web-interface/view?bvid=${id.id}`;
  const data = await fetchJson(viewUrl);
  if (data?.code !== 0) throw new Error(`视频信息获取失败：${data?.message || "B站风控或视频不存在"}`);
  const aid = data.data.aid;
  const pages = data.data.pages || [];
  const cid = page > 1 && pages[page - 1]?.cid ? pages[page - 1].cid : (data.data.cid || pages[0]?.cid);
  if (!aid || !cid) throw new Error("无法解析 Aid/Cid（视频可能已被锁定）");
  return { aid, cid };
}

// 取 CC 字幕轨：优先英文（lan=en / ai-en / lan_doc 含 English），无则抛错
async function getEnglishSubtitleUrl(aid, cid) {
  const data = await fetchJson(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`);
  if (data?.code !== 0) throw new Error(`字幕轨获取失败：${data?.message || "B站风控"}`);
  const subs = data.data?.subtitle?.subtitles || [];
  if (!subs.length) {
    throw new Error("该 B站视频未提供 CC 字幕轨（无时间戳字幕）。请改用「上传音频→Whisper 转写」，或继续粘贴外部转写结果到下方「批量导入」框。");
  }
  const enPick = subs.find(
    (s) => /^en/i.test(s.lan) || /english/i.test(s.lan_doc || ""),
  );
  if (!enPick) {
    const avail = subs.map((s) => `${s.lan_doc || s.lan}(${s.lan})`).join(" / ");
    throw new Error(`未找到英文 CC 字幕轨，仅有：${avail}。本 App 需要英文台词用于精读——请改用「上传音频→Whisper 转写」，或粘贴外部英文 SRT 到下方导入框。`);
  }
  return { url: enPick.subtitle_url, lan: enPick.lan, lan_doc: enPick.lan_doc };
}

async function fetchSubtitleContent(url) {
  const full = url.startsWith("//") ? `https:${url}` : url;
  const data = await fetchJson(full);
  return Array.isArray(data?.body) ? data.body : [];
}

// 主入口：拿台词行返回 { lines, lan_doc }，失败返回 { error }
export async function transcribeBilibiliClient(url, { signal } = {}) {
  const id = extractBilibiliId(url);
  if (!id) return { error: "不是有效的 B站 视频链接 (BV/av)" };
  const page = extractPageParam(url);
  try {
    const { aid, cid } = await getAidCid(id, page, url);
    const { url: subsUrl, lan_doc } = await getEnglishSubtitleUrl(aid, cid);
    const body = await fetchSubtitleContent(subsUrl);
    if (!body.length) return { error: "B站 CC 英文字幕轨为空。" };
    const lines = body
      .map((it) => ({
        text_en: String(it.content || "").replace(/\s+/g, " ").trim(),
        time_start: secToTimecode(it.from),
        time_end: secToTimecode(it.to),
        order: Math.floor(Number(it.from) || 0) + 1,
      }))
      .filter((l) => l.text_en);
    if (!lines.length) return { error: "B站 CC 字幕轨不含有效文本。" };
    return { lines, lan_doc };
  } catch (e) {
    return { error: e?.message || "抓取 B站 字幕失败" };
  }
}

// 写入 Subtitle 实体（接口与 importYouTubeTranscript 一致）
export async function importBilibiliTranscript(episode, onProgress) {
  const { lines, error, lan_doc } = await transcribeBilibiliClient(episode.video_url);
  if (error) return { error };
  const movieId = episode.movie_id;
  if (!movieId) return { error: "该 Episode 未绑定 movie_id，无法写入字幕。" };
  const records = lines.map((l) => ({
    movie_id: movieId,
    episode_id: episode.id,
    text_en: l.text_en,
    order: l.order,
    timestamp: l.time_start,
    time_start: l.time_start,
    time_end: l.time_end,
    speaker: "",
    analysis_status: "none",
  }));
  onProgress?.(`正在导入 ${records.length} 条台词（来源：B站 CC ${lan_doc || "en"}）…`);
  const created = await base44.entities.Subtitle.bulkCreate(records);
  return {
    count: Array.isArray(created) ? created.length : records.length,
    source: "bilibili_cc",
    lan_doc,
  };
}