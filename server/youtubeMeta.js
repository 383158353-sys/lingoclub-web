import { videoId as extractVideoId } from "./transcript/youtubeTranscriptService.js";
import { cleanVideoTitle } from "../src/lib/videoTitle.js";

// Real YouTube title / thumbnail / embeddability for a video.
// 1. oEmbed (free). Returns 401/403 when the owner disabled embedding, which
//    also tells us the video cannot play in the in-app iframe player.
// 2. Watch page <meta name="title"> (free; may be challenged on Vercel IPs).
// 3. Supadata /youtube/video (1 credit) when SUPADATA_API_KEY is set.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const metaCache = new Map();

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, value) => { try { return String.fromCodePoint(Number(value)); } catch { return ""; } })
    .replace(/&#x([\da-f]+);/gi, (_, value) => { try { return String.fromCodePoint(parseInt(value, 16)); } catch { return ""; } })
    .trim();
}

export function titleFromWatchHtml(html) {
  const text = String(html || "");
  const raw = text.match(/<meta\s+name="title"\s+content="([^"]*)"/i)?.[1]
    || text.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1]
    || text.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s*-\s*YouTube\s*$/i, "");
  const title = cleanVideoTitle(decodeHtml(raw));
  return title && title !== "YouTube" ? title : "";
}

export async function checkOEmbed(id, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401 || response.status === 403) return { embeddable: false, title: "", thumbnail_url: "" };
    if (response.status === 404 || response.status === 400) return { embeddable: null, title: "", thumbnail_url: "", notFound: true };
    if (!response.ok) return { embeddable: null, title: "", thumbnail_url: "" };
    const data = await response.json().catch(() => ({}));
    return { embeddable: true, title: cleanVideoTitle(data?.title), thumbnail_url: String(data?.thumbnail_url || ""), author: String(data?.author_name || "") };
  } catch {
    return { embeddable: null, title: "", thumbnail_url: "" };
  }
}

async function watchPageTitle(id, fetchImpl) {
  try {
    const response = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=PENDING+987" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return "";
    return titleFromWatchHtml(await response.text());
  } catch {
    return "";
  }
}

async function supadataTitle(id, env, fetchImpl) {
  const apiKey = String(env.SUPADATA_API_KEY || "").trim();
  if (!apiKey) return null;
  try {
    const response = await fetchImpl(`https://api.supadata.ai/v1/youtube/video?id=${encodeURIComponent(id)}`, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data?.title ? { title: cleanVideoTitle(data.title), thumbnail_url: String(data.thumbnail || "") } : null;
  } catch {
    return null;
  }
}

export async function getYouTubeMeta(input, env = process.env, { fetchImpl = fetch, useCache = true } = {}) {
  const id = extractVideoId(input);
  if (!id) return null;
  const cached = useCache ? metaCache.get(id) : null;
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.value;

  const oembed = await checkOEmbed(id, { fetchImpl });
  let title = oembed.title;
  let titleSource = title ? "oembed" : null;
  let thumbnail = oembed.thumbnail_url;
  if (!title) {
    title = await watchPageTitle(id, fetchImpl);
    if (title) titleSource = "watch-page";
  }
  if (!title) {
    const supa = await supadataTitle(id, env, fetchImpl);
    if (supa?.title) { title = supa.title; titleSource = "supadata"; thumbnail = thumbnail || supa.thumbnail_url; }
  }
  const value = {
    videoId: id,
    title,
    titleSource,
    thumbnail_url: thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    author_name: oembed.author || "",
    embeddable: oembed.embeddable,
  };
  if (title && useCache) {
    if (metaCache.size >= 500) metaCache.delete(metaCache.keys().next().value);
    metaCache.set(id, { savedAt: Date.now(), value });
  }
  return value;
}

export async function handleYouTubeMeta(_req, res, body, env = process.env, options = {}) {
  const meta = await getYouTubeMeta(String(body?.url || ""), env, options);
  if (!meta) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "不是有效的 YouTube 链接或 videoId", reason: "invalid_video_id" }));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify(meta));
}
