// 浏览器端 YouTube 字幕抓取器
// ------------------------------------------------------------
// Base44 后端位于数据中心 IP，YouTube 几乎对所有公共 Innertube 客户端
// 与第三方付费代理都返回 LOGIN_REQUIRED / 403。但用户浏览器是住宅 IP，
// 因此从用户浏览器出发、经 corsproxy 等代发服务请求 watch 页通常能拿到
// 完整 ytInitialPlayerResponse，其中含已签名的 captionTracks baseUrl，
// 再向 timedtext 端点请求 json3 即可拿到带时间戳的事件。
// 一旦失败（比如该视频本就没有字幕轨 / 代发服务也已被 YouTube 屏蔽），
// 返回一个明确的 error，UI 会引导用户走"复制 YouTube 转录"备选流程。
import { base44 } from "@/api/base44Client";
import { mergeFragments } from "@/lib/subtitleCleaner";

const UAS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === "youtu.be") {
      const id = u.pathname.slice(1).split(/[/?]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
    }
    if (h.endsWith("youtube.com") || h.endsWith("youtube-nocookie.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

// 保留毫秒精度：YouTube timedtext 返回 tStartMs/dDurationMs 精确到毫秒，
// 截断为整数秒会导致多个事件共享同一 time_start，分句后时间轴错乱。
function msToTimecode(ms) {
  const totalSec = ms / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec - h * 3600 - m * 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

// 清洗 YouTube 字幕段文本：兼容自动生成的 ASR 噪声标记、HTML 实体、BOM/
// 零宽字符/软连字符等异常字符。统一为可读的、纯英文字幕文本——既提升 AI
// 精读质量（避免 LLM 把 ">" 之类当真实字符学习），又让点击台词文字
// 看起来干净，避免观众看到 "[Music] >> The next morning ..." 之类的仪器串。
function cleanUtf8(t) {
  if (!t) return "";
  let s = String(t);
  // HTML 实体解码（部分 auto-generated 字幕里 utf8 仍有少量 entity 转义）
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } });
  // YouTube ASR embeds <s> tags INSIDE words — replace <s> with the letter 's'
  // so "Pre<s>ident" → "President" instead of "Preident"
  // Use <s\b[^>]*> to also match <s t="500"> (with attributes)
  s = s.replace(/<s\b[^>]*>/gi, "s").replace(/<\/s\b[^>]*>/gi, "");
  // Strip remaining HTML/VTT tags (<i>, <b>, <c.color>, etc.)
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  // 行首本地化时间戳前缀："1分钟3秒钟- ""1分15秒♪ ""30秒钟 " 等 → 剥掉只保留台词
  s = s.replace(/^\s*(?:\d+\s*(?:分(?:鐘|钟)?|min(?:ute)?s?)\s*(?:\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))?|\d+\s*(?:秒(?:钟)?|sec(?:ond)?s?))\s*[-–—:♪♫♩♬\s]*/i, "");
  // ASR 音效/噪声标记：[Music], [Applause], [Laughter], [Cheering], [Crowd noise],
  // (Applause) 等整段或末段括号内容清除。空保留以保持时间戳连续。
  s = s
    .replace(/\[(?:Music|Applause|Laughter|Cheering|Cheers|Crowd(?:\s+\w+)?|Noise|Background(?:\s+\w+)?|Faint\w*|Sound(?:s|\s+\w+)?|G__.+?|I__.+?)\]/gi, " ")
    .replace(/\((?:Music|Applause|Laughter|Cheers|Crowd noise|Sound\w*|Indistinct)\)/gi, " ");
  // 删除 ASR "对话" 标记：行首 ">> " 表示换说话人、"\n" 折叠为空格
  s = s.replace(/^>>\s*/g, "");
  // 异常字符：BOM / 零宽连接/分隔符 / 软连字符 / RTL-LTR 方向标记 / Unicode 替换符
  s = s.replace(/[\uFEFF\u00AD\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\uFFFD]/g, "");
  // 非破折空格 / 各类连字符 / 全角空格 → 半角
  s = s.replace(/[\u00a0\u202f\u2007\u3000]/g, " ");
  s = s.replace(/[—–‐‑‒]/g, "-");
  // 多余空白收敛
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const BLOCKED_RX = /blocking us from fetching subtitles|currently blocking|Sign in to confirm you(\u2019|'|’)?re not a bot|Our systems have detected/i;

// 把 YouTube json3 events 折叠为 {text_en, time_start, time_end} 列表。
// 兼容多种 quirks：
//   • `segs` 内只有部分对象带 utf8 → 拼接所有 utf8 字段
//   • `tStartMs` 缺失但 `dStartMs` 存在 (旧命名) → fallback
//   • `dDurationMs` 缺失 → 按文本长度估算 1.5–8 秒
//   • 纯空白事件、音效占位、阻塞提示 → 跳过
//   • 连续重复事件（auto-gen 偶有重复发同一行） → 折叠去重
function eventsToLines(events) {
  if (!Array.isArray(events)) return null;
  const out = [];
  let prevStart = -1;
  let prevText = "";
  for (const ev of events) {
    const segText = Array.isArray(ev?.segs)
      ? ev.segs.map((seg) => (seg && typeof seg.utf8 === "string" ? seg.utf8 : "")).join("")
      : "";
    const t = cleanUtf8(segText);
    if (!t || BLOCKED_RX.test(t)) continue;
    const start = Number.isFinite(Number(ev?.tStartMs)) ? Number(ev.tStartMs) : Number(ev?.dStartMs);
    if (!Number.isFinite(start) || start < 0) continue;
    // 去掉"几乎与上一行同时间戳同样文本"的重复行（auto-gen 噪声）
    if (start === prevStart && t === prevText) continue;
    prevStart = start;
    prevText = t;
    const dur = Number.isFinite(Number(ev?.dDurationMs)) && Number(ev.dDurationMs) > 0
      ? Number(ev.dDurationMs)
      : Math.max(1500, Math.min(8000, t.length * 80));
    // 保留 YouTube 原始事件级时间戳（tStartMs/dDurationms 是准确的），不再逐词
    // 按字符比例拆分——逐词拆分会引入估算误差，且 segment-subtitles 后端还会
    // 再做一次逐词分配，双重估算导致时间轴对不上视频。事件级时间戳交给
    // mergeFragments 合并、segment-subtitles 对齐时只需一层估算，精度更高。
    out.push({ text_en: t, time_start: msToTimecode(start), time_end: msToTimecode(start + dur) });
  }
  return out.length ? out : null;
}

// 从 watch 页 HTML 中提取 captionTracks 数组（用中括号深度配对，比正则稳健）
function extractCaptionTracks(html) {
  const idx = html.indexOf('"captionTracks":[');
  if (idx < 0) return null;
  const start = html.indexOf("[", idx);
  let depth = 0, inStr = false, esc = false, i = start;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) { esc = false; } else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  try {
    const arr = JSON.parse(html.slice(start, i + 1));
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

async function fetchWithTimeout(u, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(u, { signal: ctrl.signal, headers: { "User-Agent": UAS, Accept: "text/html,*/*" } });
  } finally { clearTimeout(id); }
}

// 从 watch 页里抓 captionTracks，再向签名 baseUrl 拉 json3 事件。
// timedtext 直连失败时（CORS），通过获取 HTML 的同一代理重试。
async function fetchTracksFromHtml(html, proxyFn) {
  const tracks = extractCaptionTracks(html);
  if (!tracks || !tracks.length) return null;
  const pick =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ||
    tracks.find((t) => String(t.languageCode || "").startsWith("en")) ||
    tracks[0];
  let baseUrl = pick?.baseUrl || "";
  if (!baseUrl) return null;
  baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, "");
  const sep = baseUrl.includes("?") ? "&" : "?";
  const capUrl = `${baseUrl}${sep}fmt=json3`;

  // 策略 A：timedtext 直连（YouTube 嵌入播放器就是跨域使用，CORS 默认开放）
  try {
    const capRes = await fetchWithTimeout(capUrl, 10000);
    if (capRes.ok) {
      const txt = await capRes.text();
      if (txt && txt.trim().startsWith("{")) {
        const lines = eventsToLines(JSON.parse(txt)?.events);
        if (lines) return lines;
      }
    }
  } catch { /* fall through to proxy */ }

  // 策略 B：通过同一 CORS 代理获取 timedtext（直连 CORS 被拒时）
  if (proxyFn) {
    try {
      const capRes = await fetchWithTimeout(proxyFn(capUrl), 10000);
      if (capRes.ok) {
        const txt = await capRes.text();
        if (txt && txt.trim().startsWith("{")) {
          const lines = eventsToLines(JSON.parse(txt)?.events);
          if (lines) return lines;
        }
      }
    } catch { /* give up on this proxy */ }
  }

  return null;
}

// 公共 CORS 代理并行竞速（浏览器住宅 IP）。多数公共代理已不稳定或被 YouTube
// 限流，因此并行短超时快速试一轮：任一返回含 captionTracks 的 HTML 即胜出，
// 全部失败则在 ~8s 内快速返回，避免用户长时间等待后再失败。
async function fetchWatchViaProxies(watchUrl) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u) => `https://proxy.cors.sh/${u}`,
  ];
  const tryProxy = async (mk) => {
    try {
      const r = await fetchWithTimeout(mk(watchUrl), 8000);
      if (!r.ok) return null;
      const html = await r.text();
      if (!html || !html.includes('"captionTracks"')) return null;
      return await fetchTracksFromHtml(html, mk);
    } catch { return null; }
  };
  try {
    return await Promise.any(proxies.map((mk) => tryProxy(mk).then((l) => (l && l.length) ? l : Promise.reject(new Error('empty')))));
  } catch { return null; }
}

// 也可直接通过 Innertube player（部分情况下 CORS 会允许）。
async function fetchViaInnertubeClient(videoId) {
  const clients = [
    { name: "WEB", ver: "2.20240101.00.00", key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8" },
    { name: "ANDROID", ver: "20.10.38", key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w" },
  ];
  for (const c of clients) {
    try {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), 9000);
      let postRes;
      try {
        postRes = await fetch(
          `https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${c.key}`,
          {
            method: "POST",
            signal: ctrl.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              context: { client: { hl: "en", gl: "US", clientName: c.name, clientVersion: c.ver } },
              videoId,
            }),
          },
        );
      } finally { clearTimeout(id); }
      if (!postRes.ok) continue;
      const player = await postRes.json();
      const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) continue;
      const pick =
        tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
        tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ||
        tracks.find((t) => String(t.languageCode || "").startsWith("en")) ||
        tracks[0];
      let baseUrl = pick?.baseUrl || "";
      if (!baseUrl) continue;
      baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, "");
      const sep = baseUrl.includes("?") ? "&" : "?";
      const capRes = await fetchWithTimeout(`${baseUrl}${sep}fmt=json3`, 9000);
      if (!capRes.ok) continue;
      const txt = await capRes.text();
      if (!txt || !txt.trim().startsWith("{")) continue;
      const cap = JSON.parse(txt);
      const lines = eventsToLines(cap?.events);
      if (lines) return lines;
    } catch { /* try next client */ }
  }
  return null;
}

// 主入口：优先调用后端函数（服务端直接 fetch，无 CORS 限制），
// 失败后回退到客户端 CORS 代理（用户浏览器 IP）。拿到台词行就返回数组，
// 否则返回 { error }。
export async function transcribeYouTubeClient(url, { signal } = {}) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return { error: "不是有效的 YouTube 链接" };

  // 1. 原版入口：调用原应用已经部署的 Base44 字幕函数。
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // invoke 的响应代理会截断较长字幕；直接请求同一个原版函数，保留完整响应。
    const response = await base44.functions.fetch("/youtube-transcript", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }), signal,
    });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error || "字幕服务请求失败");
      error.response = { status: response.status, data };
      throw error;
    }
    if (data?.lines?.length) return { lines: mergeFragments(data.lines) };
    // 后端返回错误 → 继续尝试客户端
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    const backendError = error?.response?.data?.error;
    if (error?.response?.status === 401 || error?.response?.status === 403
      || backendError === "Authentication required to view users") {
      return { error: "请先连接原版 LingoClub 账号，再获取字幕。", code: "BASE44_AUTH_REQUIRED" };
    }
  }

  // 2. 客户端 CORS 代理（用户浏览器住宅 IP）— 跳过 Innertube 直调
  //    （浏览器 CORS 对 /youtubei/v1/player 始终拒绝，不再浪费时间）
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`;

  let lines = null;
  try { lines = await fetchWatchViaProxies(watchUrl); } catch { /* fall through */ }
  if (!lines || !lines.length) {
    return {
      error: 'YouTube 风控拦截：服务器端和浏览器代理均被 YouTube 拦截。请使用下方「字幕提取书签工具」直接在 YouTube 页面提取字幕。',
    };
  }
  return { lines: mergeFragments(lines) };
}
