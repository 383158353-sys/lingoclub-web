import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// YouTube 字幕抓取（服务端）：
// 直接在服务端 fetch YouTube watch 页面 HTML → 提取 captionTracks →
// 请求已签名的 timedtext baseUrl (json3) → 返回带时间戳的台词列表。
// 服务端请求不受浏览器 CORS 限制，无需依赖不稳定的公共代理。
const UAS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function extractVideoId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === 'youtu.be') {
      const id = u.pathname.slice(1).split(/[/?]/)[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
    }
    if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function cleanUtf8(t) {
  if (!t) return '';
  let s = String(t);
  s = s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } });
  // YouTube ASR embeds <s> tags INSIDE words — replace <s> with the letter 's'
  // so "Pre<s>ident" → "President" instead of "Preident"
  // Use <s\b[^>]*> to also match <s t="500"> (with attributes)
  s = s.replace(/<s\b[^>]*>/gi, 's').replace(/<\/s\b[^>]*>/gi, '');
  // Strip remaining HTML/VTT tags (<i>, <b>, <c.color>, etc.)
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s
    .replace(/\[(?:Music|Applause|Laughter|Cheering|Cheers|Crowd(?:\s+\w+)?|Noise|Background(?:\s+\w+)?|Faint\w*|Sound(?:s|\s+\w+)?|G__.+?|I__.+?)\]/gi, ' ')
    .replace(/\((?:Music|Applause|Laughter|Cheers|Crowd noise|Sound\w*|Indistinct)\)/gi, ' ');
  s = s.replace(/^>>\s*/g, '');
  s = s.replace(/[\uFEFF\u00AD\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2060\uFFFD]/g, '');
  s = s.replace(/[\u00a0\u202f\u2007\u3000]/g, ' ');
  s = s.replace(/[—–‐‑‒]/g, '-');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const BLOCKED_RX = /blocking us from fetching subtitles|currently blocking|Sign in to confirm you(\u2019|'|')?re not a bot|Our systems have detected/i;

function eventsToLines(events) {
  if (!Array.isArray(events)) return null;
  const out = [];
  let prevStart = -1;
  let prevText = '';
  for (const ev of events) {
    const segText = Array.isArray(ev?.segs)
      ? ev.segs.map((seg) => (seg && typeof seg.utf8 === 'string' ? seg.utf8 : '')).join('')
      : '';
    const t = cleanUtf8(segText);
    if (!t || BLOCKED_RX.test(t)) continue;
    const start = Number.isFinite(Number(ev?.tStartMs)) ? Number(ev.tStartMs) : Number(ev?.dStartMs);
    if (!Number.isFinite(start) || start < 0) continue;
    if (start === prevStart && t === prevText) continue;
    prevStart = start;
    prevText = t;
    const dur = Number.isFinite(Number(ev?.dDurationMs)) && Number(ev.dDurationMs) > 0
      ? Number(ev.dDurationMs)
      : Math.max(1500, Math.min(8000, t.length * 80));
    // Split into individual words with proportional timestamps so mergeFragments
    // can build accurately-timed sentences after splitting/merging
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;
    let accMs = start;
    for (const word of words) {
      const wordDur = Math.max(100, (word.length / totalChars) * dur);
      out.push({ text_en: word, time_start: msToTimecode(accMs), time_end: msToTimecode(accMs + wordDur) });
      accMs += wordDur;
    }
  }
  const dedup = [];
  for (const l of out) {
    const last = dedup[dedup.length - 1];
    if (last && last.text_en === l.text_en && last.time_start === l.time_start) continue;
    dedup.push(l);
  }
  return dedup.length ? dedup : null;
}

function extractCaptionTracks(html) {
  const idx = html.indexOf('"captionTracks":[');
  if (idx < 0) return null;
  const start = html.indexOf('[', idx);
  let depth = 0, inStr = false, esc = false, i = start;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) { esc = false; } else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  try {
    const arr = JSON.parse(html.slice(start, i + 1));
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return Response.json({ error: 'Missing url' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) return Response.json({ error: '不是有效的 YouTube 链接' }, { status: 400 });

    // YouTube 字幕获取：多策略并行竞速 + 每策略独立超时。
    // 串行执行时单个客户端挂起会拖垮整体（曾出现 25s 超时），并行后任一成功即胜出，
    // 全部失败也能在 ~8s 内快速返回，便于客户端重试命中非限流窗口。
    const clients = [
      // ANDROID_VR 客户端——数据中心 IP 下仍可返回完整 captionTracks（含签名 baseUrl）
      {
        name: 'ANDROID_VR', ver: '1.37.14', key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
        ua: 'com.google.android.apps.youtube.vr.oculus/1.37.14 (Linux; U; Android 12L;)',
        extraHeaders: {},
      },
      // ANDROID 客户端用 Android UA，不加浏览器专用头
      {
        name: 'ANDROID', ver: '20.10.38', key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
        ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
        extraHeaders: {},
      },
      // TVHTML5 客户端（电视端，限流较宽松）
      {
        name: 'TVHTML5', ver: '7.20240813.07.00', key: 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8',
        ua: 'Mozilla/5.0 (PlayStation 4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
        extraHeaders: {},
      },
      // WEB 客户端用浏览器 UA + Origin/Referer
      {
        name: 'WEB', ver: '2.20240813.07.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
        ua: UAS,
        extraHeaders: { 'Origin': 'https://www.youtube.com', 'Referer': 'https://www.youtube.com/' },
      },
      // IOS 客户端——有时可绕过部分限流
      {
        name: 'IOS', ver: '2.20240813.07.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
        ua: 'com.google.ios.youtube/20.10.4 (iPhone14,5; U; CPU iOS 16_4 like Mac OS X)',
        extraHeaders: {},
      },
    ];

    const fetchWithTimeout = (url, opts, timeoutMs) => {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeoutMs);
      return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
    };

    // Innertube Player API：POST 拿 captionTracks
    const fetchPlayerTracks = async (c, timeoutMs) => {
      try {
        const r = await fetchWithTimeout(`https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=${c.key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'Accept': 'application/json', ...c.extraHeaders },
          body: JSON.stringify({ context: { client: { hl: 'en', gl: 'US', clientName: c.name, clientVersion: c.ver } }, videoId }),
        }, timeoutMs);
        if (!r.ok) return null;
        const player = await r.json();
        const ct = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        return ct.length ? ct : null;
      } catch { return null; }
    };

    // watch 页面 HTML：解析 ytInitialPlayerResponse 中的 captionTracks
    const fetchWatchTracks = async (timeoutMs) => {
      try {
        const r = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`, {
          headers: {
            'User-Agent': UAS,
            'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'CONSENT=PENDING+987',
          },
          redirect: 'follow',
        }, timeoutMs);
        if (!r.ok) return null;
        const html = await r.text();
        if (BLOCKED_RX.test(html)) return null;
        return extractCaptionTracks(html);
      } catch { return null; }
    };

    // 并行竞速 + 自动重试：YouTube 对数据中心 IP 的限流是间歇性的（单次约 50% 成功），
    // 因此失败后短暂等待再试一轮，通常 2 次内即可命中非限流窗口；最坏 ~12s 快速失败。
    let tracks = null;
    for (let attempt = 0; attempt < 2 && !tracks; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      try {
        tracks = await Promise.any([
          ...clients.map((c) => fetchPlayerTracks(c, 6000)),
          fetchWatchTracks(6000),
        ].map((p) => p.then((t) => (t && t.length) ? t : Promise.reject(new Error('empty')))));
      } catch { /* all strategies failed this attempt → retry */ }
    }

    if (!tracks || !tracks.length) {
      // 服务端全部策略失败 → 返回错误，客户端会自动回退到浏览器 CORS 代理
      return Response.json({ error: '服务端无法获取字幕（IP 被限流），客户端将自动回退' }, { status: 502 });
    }

    // 优先选择英文字幕（非 ASR），其次 ASR 英文，再次任何 en 开头，最后第一条
    const pick =
      tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ||
      tracks.find((t) => String(t.languageCode || '').startsWith('en')) ||
      tracks[0];

    let baseUrl = pick?.baseUrl || '';
    if (!baseUrl) return Response.json({ error: '字幕轨道无有效URL' }, { status: 500 });

    // 清理 fmt 参数，追加 json3 格式请求
    baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, '');
    const sep = baseUrl.includes('?') ? '&' : '?';

    const capRes = await fetch(`${baseUrl}${sep}fmt=json3`, {
      headers: { 'User-Agent': UAS, 'Accept': 'application/json,*/*' },
    });

    if (!capRes.ok) {
      return Response.json({ error: `字幕下载失败 (HTTP ${capRes.status})` }, { status: 502 });
    }

    const capText = await capRes.text();
    if (!capText || !capText.trim().startsWith('{')) {
      return Response.json({ error: '字幕格式异常' }, { status: 500 });
    }

    const cap = JSON.parse(capText);
    const lines = eventsToLines(cap?.events);

    if (!lines || !lines.length) {
      return Response.json({ error: '字幕解析为空' }, { status: 500 });
    }

    return Response.json({ lines, trackLanguage: pick.languageCode });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}