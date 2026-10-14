import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { getAuthSupabase } from "./aiCredentials.js";

const MAX_HTML_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2)
      || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip.startsWith("::ffff:")) return publicAddress(ip.slice(7));
    if (ip.startsWith("2001:db8:")) return false;
    return ip.startsWith("2") || ip.startsWith("3");
  }
  return false;
}

export async function validateArticleFetchUrl(input, resolve = lookup) {
  if (typeof input !== "string" || !input.trim() || input.length > 2048) throw failure(400, "请填写有效的文章链接");
  let url;
  try { url = new URL(input.trim()); }
  catch { throw failure(400, "请填写有效的文章链接"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port && !["80", "443"].includes(url.port)) {
    throw failure(400, "只支持公开的 http(s) 文章链接");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!isIP(hostname) && !hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw failure(400, "不能提取本机或内网地址");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw failure(400, "不能提取本机或内网地址");
  url.hash = "";
  return url;
}

async function readHtml(response) {
  const type = response.headers.get("content-type") || "";
  if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw failure(422, "链接未返回可读取的网页正文");
  const reader = response.body?.getReader();
  if (!reader) throw failure(502, "网页没有返回正文");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_HTML_BYTES) { await reader.cancel(); throw failure(413, "网页内容过大，请手动粘贴正文"); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function extractArticleFromHtml(html, sourceUrl) {
  const dom = new JSDOM(html, { url: sourceUrl });
  try {
    const doc = dom.window.document;
    const meta = (selector) => doc.querySelector(selector)?.getAttribute("content")?.trim() || "";
    const originalTitle = meta('meta[property="og:title"]') || doc.querySelector("h1")?.textContent?.trim() || doc.title;
    const byline = meta('meta[name="author"]') || meta('meta[property="article:author"]');
    const outlet = meta('meta[property="og:site_name"]') || new URL(sourceUrl).hostname.replace(/^www\./, "");
    const article = new Readability(doc).parse();
    if (!article?.content) throw failure(422, "无法自动提取，请粘贴正文");
    const content = new JSDOM(article.content).window.document;
    const paragraphs = [...content.querySelectorAll("p, h2, h3, blockquote")]
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 15);
    const body_en = [...new Set(paragraphs)].join("\n\n").slice(0, 50000);
    if (body_en.length < 100) throw failure(422, "无法自动提取，请粘贴正文");
    const title = (article.title || originalTitle || "").trim().slice(0, 300);
    if (!title) throw failure(422, "无法自动识别标题，请手动填写");
    return {
      title,
      body_en,
      author: (byline || article.byline || "").trim().slice(0, 120),
      outlet: outlet.slice(0, 120),
      source_url: sourceUrl,
    };
  } finally { dom.window.close(); }
}

export async function fetchArticle(input, { fetchImpl = fetch, resolve = lookup } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = await validateArticleFetchUrl(input, resolve);
    for (let step = 0; step <= MAX_REDIRECTS; step += 1) {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        redirect: "manual", signal: controller.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (step === MAX_REDIRECTS) throw failure(502, "网页跳转次数过多，请手动粘贴正文");
        const location = response.headers.get("location");
        if (!location) throw failure(502, "网页跳转地址无效，请手动粘贴正文");
        url = await validateArticleFetchUrl(new URL(location, url).href, resolve);
        continue;
      }
      if (!response.ok) throw failure(502, "网页暂时无法读取，可能需要登录或限制抓取；请手动粘贴正文");
      return extractArticleFromHtml(await readHtml(response), url.href);
    }
    throw failure(502, "网页跳转次数过多，请手动粘贴正文");
  } catch (error) {
    if (error?.name === "AbortError") throw failure(504, "提取超时，请手动粘贴正文");
    if (error?.status) throw error;
    throw failure(502, "无法自动提取，请粘贴正文");
  } finally { clearTimeout(timer); }
}

async function verifyUser(req, env) {
  const token = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw failure(401, "请先登录后提取文章");
  const { data, error } = await getAuthSupabase(env).auth.getUser(token);
  if (error || !data?.user?.id) throw failure(401, "请先登录后提取文章");
}

export async function handleArticleExtract(req, res, body, env = process.env, { authenticate = verifyUser, extract = fetchArticle } = {}) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (status, payload) => { res.statusCode = status; res.end(JSON.stringify(payload)); };
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(405, { error: "仅支持 POST 请求" }); }
  try {
    await authenticate(req, env);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw failure(400, "请求格式无效");
    const article = await extract(body.url);
    return send(200, article);
  } catch (error) {
    return send(error?.status >= 400 && error?.status <= 599 ? error.status : 502, { error: error?.status ? error.message : "无法自动提取，请粘贴正文" });
  }
}
