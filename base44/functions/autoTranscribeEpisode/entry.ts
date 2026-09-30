import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Auto-transcribes an episode's video into English subtitle lines.
// Two paths:
//   1. YouTube — we fetch the video's official CC caption tracks (auto-
//      generated for most English content), which already contain per-line
//      timestamps. No Whisper, no audio download. Every imported line is
//      click-to-seek ready.
//   2. Uploaded media URL (MP4/M4A/MP3, ≤25MB) — Whisper transcription. Whisper
//      returns plain text with no timestamps; creators can fill them in the
//      字幕管理 panel to enable real-time follow.
// B站 embeds and b23 short links cannot be transcribed either way.

// ---- YouTube helpers -------------------------------------------------------
function extractYouTubeId(url: string): string | null {
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

function msToTimecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Discovery via YouTube's Innertube `player` endpoint instead of scraping the
// watch page — data-center IPs routinely get HTTP 429 from the watch page,
// whereas the Innertube player API (Android client) hands back the same
// captionTracks list (with signed baseUrls) reliably server-side.
const UAS = {
  ANDROID: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11; gzip)',
  WEB: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  TV: 'Mozilla/5.0 (PlayStation 4; PlayStation) AppleWebKit/605.1.17 (KHTML, like Gecko) VTEWebKit',
  IOS: 'com.google.ios.youtube/20.10.4 (iPhone15,4; U; CPU iOS 17_5_1 like Mac OS X)',
};

async function innertubePlayer(videoId: string, clientName: string, clientVersion: string, apiKey: string, extra: any = null): Promise<any> {
  const body: any = {
    context: { client: { hl: 'en', gl: 'US', clientName, clientVersion } },
    videoId,
  };
  if (extra) body.thirdParty = extra;
  const keyParam = apiKey ? `&key=${apiKey}` : '';
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?prettyPrint=false${keyParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UAS[clientName] || UAS.WEB },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`YouTube ${clientName} HTTP ${res.status}`);
  return res.json();
}

async function fetchYouTubeCaptions(videoId: string): Promise<Array<{ text_en: string; time_start: string; time_end: string }>> {
  // Try the most permissive Innertube clients first — TVHTML5 SIMPLY_EMBEDDED_PLAYER
  // is famous for NOT triggering LOGIN_REQUIRED bot checks (no API key needed).
  // Then WEB (some videos only return manual captions here, ASR omitted),
  // then ANDROID (ASR tracks exposed). If all fail, fall back to the legacy
  // unsigned timedtext endpoint as a last resort (works for non-DRM content).
  const clients: Array<{ name: string; ver: string; key: string; extra?: any }> = [
    { name: 'TVHTML5', ver: '7.20240813.04.00', key: '', extra: { embedUrl: 'https://www.google.com' } },
    { name: 'WEB', ver: '2.20240101.00.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' },
    { name: 'ANDROID', ver: '20.10.38', key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w' },
    { name: 'IOS', ver: '20.10.4', key: 'AIzaSyB-63vPrdThhJuerNoISZx1w4jIBM90BV0' },
  ];
  let player: any = null;
  let tracks: any[] = [];
  for (const c of clients) {
    try {
      player = await innertubePlayer(videoId, c.name, c.ver, c.key, c.extra);
      tracks = player?.captions?.playerCaptionTracklistRenderer?.captionTracks || [];
      if (tracks.length) break;
    } catch { /* try next client */ }
  }
  // —— 走到这里：所有 Innertube 客户端都被风控拦截 ——
  // 尝试无签名 legacy timedtext 端点（部分非 DRM 视频可用）
  try {
    const legacyRes = await fetch(`https://video.google.com/timedtext?lang=en&v=${videoId}&fmt=json3`, {
      headers: { 'User-Agent': UAS.WEB },
    });
    if (legacyRes.ok) {
      const txt = await legacyRes.text();
      if (txt && txt.trim().startsWith('{')) {
        const cap: any = JSON.parse(txt);
        const events: any[] = cap?.events || [];
        const out2: Array<{ text_en: string; time_start: string; time_end: string }> = [];
        for (const ev of events) {
          if (!Array.isArray(ev?.segs)) continue;
          const t = ev.segs.map((s: any) => s?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          const s = Number(ev.tStartMs) || 0;
          const d = Number(ev.dDurationMs) || Math.max(1500, Math.min(8000, t.length * 80));
          out2.push({ text_en: t, time_start: msToTimecode(s), time_end: msToTimecode(s + d) });
        }
        if (out2.length) return out2;
      }
    }
  } catch { /* ignore — fall through */ }

  // 公共 CORS 代理抓取 watch 页面，绕过数据中心 IP 风控
  // 代理出口通常是民用 IP，watch 页会带 ytInitialPlayerResponse
  // 其中 captionTracks baseUrls 已签名，可直接拉取 json3 字幕
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`;
  // 公共代理链：Jina AI reader（已签名服务，部署在 Fastly 上）最稳定；
  // allorigins.win / codetabs 作为备选。返回的 HTML 里我们直接找 captionTracks
  // 配对，Jina 默认会渲染完整 watch 页，里面通常包含 ytInitialPlayerResponse。
  const proxies = [
    { mk: (u: string) => `https://r.jina.ai/${u}`, html: true, timeout: 12000 },
    { mk: (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, html: true, timeout: 10000 },
    { mk: (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`, html: true, timeout: 10000 },
  ];
  const fetchWith = (u: string, ms: number): Promise<Response> => {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), ms);
    return fetch(u, { signal: c.signal, headers: { 'User-Agent': UAS.WEB, Accept: 'text/html' } })
      .finally(() => clearTimeout(id));
  };
  // 从 HTML 文本里提取 captionTracks 数组（JSON 中括号配对，而非脆弱的正则）
  function extractCaptionTracks(html: string): any[] | null {
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
  let proxyDiag = '';
  for (let i = 0; i < proxies.length; i++) {
    const p = proxies[i];
    try {
      const pr = await fetchWith(p.mk(watchUrl), p.timeout);
      const html = pr.ok ? await pr.text() : '';
      proxyDiag += `[P${i} ok=${pr.ok} status=${pr.status} len=${html.length}] `;
      const pr_tracks = extractCaptionTracks(html);
      if (pr.ok && (!pr_tracks || !pr_tracks.length)) {
        const hasConsent = /consent\.google\.com|Before you continue/i.test(html);
        const hasBotCheck = /Our systems have detected|robot|Sign in to confirm/i.test(html);
        proxyDiag += `(${hasConsent ? 'consent' : hasBotCheck ? 'bot' : 'no-caption-tracks'}) `;
      }
      if (!pr.ok || !pr_tracks || !pr_tracks.length) continue;
      // 用与主路径相同的选轨策略
      const pick =
        pr_tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
        pr_tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ||
        pr_tracks.find((t) => String(t.languageCode || '').startsWith('en')) ||
        pr_tracks[0];
      let baseUrl: string = pick?.baseUrl || '';
      if (!baseUrl) continue;
      baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, '');
      const sep = baseUrl.includes('?') ? '&' : '?';
      // 直接拉取签名 URL（签名已包含授权，IP 通常不再校验）
      const capRes = await fetchWith(`${baseUrl}${sep}fmt=json3`, 8000);
      if (!capRes.ok) continue;
      const capText = await capRes.text();
      if (!capText || !capText.trim().startsWith('{')) continue;
      const cap: any = JSON.parse(capText);
      const events: any[] = cap?.events || [];
      const out4: Array<{ text_en: string; time_start: string; time_end: string }> = [];
      for (const ev of events) {
        if (!Array.isArray(ev?.segs)) continue;
        const t = ev.segs.map((s: any) => s?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const s = Number(ev.tStartMs) || 0;
        const d = Number(ev.dDurationMs) || Math.max(1500, Math.min(8000, t.length * 80));
        out4.push({ text_en: t, time_start: msToTimecode(s), time_end: msToTimecode(s + d) });
      }
      // 过滤明显的风控占位文本（如 youtubetranscript.com 的占位串）
      const blocked = /blocking us from fetching subtitles|currently blocking/i;
      if (out4.length && !out4.some((l) => blocked.test(l.text_en))) return out4;
    } catch { /* try next proxy */ }
  }

  const pStatus = player?.playabilityStatus?.status;
  if (pStatus === 'LOGIN_REQUIRED' || pStatus === 'UNPLAYABLE' || pStatus === 'BOT_DETECTED' || !tracks.length) {
    // YouTube's bot detection blocks data-center IPs from Innertube captions.
    // The user's own browser isn't blocked, so guide them to copy the
    // transcript from YouTube's "Show transcript" panel and paste it into
    // the bulk importer (which already parses YouTube's timecode format).
    throw new Error(`YouTube 风控拦截：服务器 IP 无法抓取字幕。请改为在 YouTube 视频页面点「⋯更多 → 显示转录文字」→ 打开时间戳 → 全选复制，再粘贴到下方「批量导入」框中，可自动解析时间码并跳转。${proxyDiag ? `[diag]${proxyDiag}` : ''}`);
  }
  throw new Error(`无字幕轨(pStatus=${pStatus || 'unknown'}) capsKeys=${Object.keys(player?.captions || {}).join('|')} topKeys=${Object.keys(player || {}).slice(0, 10).join('|')}`);

  // Prefer a manually-authored English track, then English auto-generated,
  // then any en-* track, then the first track fallback.
  const pick =
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === 'en' && t.kind === 'asr') ||
    tracks.find((t) => String(t.languageCode || '').startsWith('en')) ||
    tracks[0];

  let baseUrl = pick?.baseUrl as string | undefined;
  if (!baseUrl) throw new Error('未找到可用的字幕地址。');
  // Strip any existing fmt/srv3 query param so we can't end up with
  // "...&fmt=srv3...&fmt=json3" (YouTube silently returns the original format
  // when two fmt params clash, which often returned an empty body before).
  baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, '');

  // Fetch the chosen track in json3 — events carry tStartMs + dDurationMs +
  // segs (text segments). Timestamp-native format, no SRT/VTT parsing needed.
  const sep = baseUrl.includes('?') ? '&' : '?';
  const capRes = await fetch(`${baseUrl}${sep}fmt=json3`, {
    headers: { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11; gzip)' },
  });
  if (!capRes.ok) throw new Error(`拉取字幕失败 (HTTP ${capRes.status})`);
  const capText = await capRes.text();
  let cap: any = {};
  try { cap = JSON.parse(capText); } catch {
    throw new Error(`字幕 JSON 解析失败 (len=${capText.length}, head=${capText.slice(0, 200)})`);
  }
  const events: any[] = Array.isArray(cap?.events) ? cap.events : [];
  if (!events.length) {
    throw new Error(`字幕事件为空（track=${pick?.languageCode}${pick?.kind ? ':' + pick.kind : ''}, capHead=${capText.slice(0, 200)})`);
  }
  const out: Array<{ text_en: string; time_start: string; time_end: string }> = [];
  for (const ev of events) {
    if (!Array.isArray(ev?.segs)) continue;
    const text = ev.segs.map((s: any) => s?.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startMs = Number(ev.tStartMs) || 0;
    const durMs = Number(ev.dDurationMs) || Math.min(8000, Math.max(1000, text.length * 80));
    out.push({
      text_en: text,
      time_start: msToTimecode(startMs),
      time_end: msToTimecode(startMs + durMs),
    });
  }
  return out;
}
// ---------------------------------------------------------------------------

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const episodeId = (body.episode_id || '').toString().trim();
    if (!episodeId) return Response.json({ error: 'episode_id is required' }, { status: 400 });

    const episode = await base44.entities.Episode.get(episodeId);
    if (!episode) return Response.json({ error: 'Episode not found' }, { status: 404 });

    const videoUrl = (episode.video_url || '').toString().trim();
    if (!videoUrl) {
      return Response.json({ error: '该剧集尚未配置视频。请先粘贴 YouTube 链接，或上传一个 ≤25MB 的 MP4/M4A/MP3 文件链接。' }, { status: 400 });
    }

    // B站嵌入视频与 b23 短链不是可下载的媒体文件，也没有可抓取的 CC 字幕轨。
    try {
      const host = new URL(videoUrl).hostname.toLowerCase();
      if (host.includes('bilibili.com') || host === 'b23.tv') {
        return Response.json({ error: 'B站嵌入视频无法自动转写。请改为粘贴一个 YouTube 链接，或上传一个 ≤25MB 的 MP4/M4A 文件。' }, { status: 400 });
      }
    } catch {}

    // YouTube：直接拉取官方 CC 字幕轨（含时间戳），无需下载音频、无需 Whisper。
    const ytId = extractYouTubeId(videoUrl);
    if (ytId) {
      const lines = await fetchYouTubeCaptions(ytId);
      if (!lines.length) return Response.json({ error: '该 YouTube 视频没有可用的英文字幕轨。' }, { status: 400 });
      const records = lines.map((l, i) => ({
        movie_id: episode.movie_id,
        episode_id: episode.id,
        text_en: l.text_en,
        order: i + 1,
        timestamp: l.time_start,
        time_start: l.time_start,
        time_end: l.time_end,
        analysis_status: 'none',
      }));
      const created = await base44.entities.Subtitle.bulkCreate(records);
      return Response.json({
        count: Array.isArray(created) ? created.length : lines.length,
        source: 'youtube_cc',
        sample: lines.slice(0, 5),
      });
    }

    // Else: uploaded media URL → Whisper. No per-line timestamps.
    let transcript = '';
    try {
      const out = await base44.asServiceRole.integrations.Core.TranscribeAudio({ audio_url: videoUrl });
      transcript = typeof out === 'string' ? out : (out?.transcript || out?.text || '');
    } catch (e) {
      return Response.json({ error: '语音转写失败：' + (e?.message || '请确认文件为可下载的 MP4/M4A 且 ≤25MB') }, { status: 400 });
    }
    transcript = String(transcript || '').trim();
    if (!transcript) return Response.json({ error: '转写结果为空，未识别到英文语音。' }, { status: 400 });

    const lines = transcript
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+|[\n\r]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 200);

    if (lines.length === 0) return Response.json({ error: '未能切分出有效台词。' }, { status: 400 });

    const records = lines.map((text_en, i) => ({
      movie_id: episode.movie_id,
      episode_id: episode.id,
      text_en,
      order: i + 1,
      timestamp: '',
      time_start: '',
      time_end: '',
      analysis_status: 'none',
    }));

    const created = await base44.entities.Subtitle.bulkCreate(records);

    return Response.json({ count: Array.isArray(created) ? created.length : lines.length, source: 'whisper', sample: lines.slice(0, 5) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}