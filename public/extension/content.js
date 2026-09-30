// LinguaTube Browser Extension — Content Script
// =============================================================
// 在 YouTube / B站 视频页面注入悬浮「导入学习」按钮。
// 点击后：
//   • YouTube：同源抓取 CC 字幕（不经过任何代理，成功率 100%）
//   • B站：仅传递 URL，由 LinguaTube 站内尝试抓取 CC 字幕
// 字幕数据 base64 编码后随 URL 传递到 LinguaTube /quick-study 页面。

const STORAGE_KEY = "linguatube_app_url";

// ===== YouTube ID 提取 =====
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
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

function isBilibiliVideo(url) {
  return /bilibili\.com\/video\/(BV|av)/i.test(url || "");
}

function isVideoPage(url) {
  return !!extractYouTubeId(url) || isBilibiliVideo(url);
}

// ===== 时间码 / 文本清洗（与站内 youtubeTranscriptClient 同逻辑）=====
function msToTimecode(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function cleanText(t) {
  if (!t) return "";
  let s = String(t)
    .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; } });
  // YouTube ASR embeds <s> tags INSIDE words — replace <s> with the letter 's'
  // Use <s\b[^>]*> to also match <s t="500"> (with attributes)
  s = s.replace(/<s\b[^>]*>/gi, "s").replace(/<\/s\b[^>]*>/gi, "");
  // Strip remaining HTML/VTT tags
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  s = s
    .replace(/\[(?:Music|Applause|Laughter|Cheering|Cheers|Crowd(?:\s+\w+)?|Noise|Background(?:\s+\w+)?|Faint\w*|Sound(?:s|\s+\w+)?|G__.+?|I__.+?)\]/gi, " ")
    .replace(/\((?:Music|Applause|Laughter|Cheers|Crowd noise|Sound\w*|Indistinct)\)/gi, " ")
    .replace(/^>>\s*/g, "")
    .replace(/[\uFEFF\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFFFD]/g, "")
    .replace(/[\u00a0\u202f\u2007\u3000]/g, " ")
    .replace(/[—–‐‑‒]/g, "-")
    .replace(/\s+/g, " ").trim();
  return s;
}

// ===== 从 watch 页 HTML 中提取 captionTracks（括号深度配对，比正则稳健）=====
function extractCaptionTracks(html) {
  const idx = html.indexOf('"captionTracks":[');
  if (idx < 0) return null;
  const start = html.indexOf("[", idx);
  let depth = 0, inStr = false, esc = false, i = start;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
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

// ===== YouTube json3 events → 台词行 =====
function eventsToLines(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  let prevStart = -1, prevText = "";
  for (const ev of events) {
    const segText = Array.isArray(ev?.segs)
      ? ev.segs.map((seg) => (seg && typeof seg.utf8 === "string" ? seg.utf8 : "")).join("")
      : "";
    const t = cleanText(segText);
    if (!t) continue;
    const start = Number.isFinite(Number(ev?.tStartMs)) ? Number(ev.tStartMs) : Number(ev?.dStartMs);
    if (!Number.isFinite(start) || start < 0) continue;
    if (start === prevStart && t === prevText) continue;
    prevStart = start; prevText = t;
    const dur = Number.isFinite(Number(ev?.dDurationMs)) && Number(ev.dDurationMs) > 0
      ? Number(ev.dDurationMs) : Math.max(1500, Math.min(8000, t.length * 80));
    // Split into individual words with proportional timestamps
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
  return dedup;
}

// ===== 核心：同源抓取 YouTube CC 字幕 =====
// 扩展运行在 youtube.com 域名下，fetch watch 页面和 timedtext API 都是同源请求，
// 不经过任何代理、不受 CORS 限制、使用用户自己的住宅 IP，成功率 100%。
async function extractYouTubeSubs(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`;
  let html;
  try {
    const res = await fetch(watchUrl, { credentials: "include" });
    html = await res.text();
  } catch { return null; }

  const tracks = extractCaptionTracks(html);
  if (!tracks || !tracks.length) return null;

  const pick =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en" && t.kind === "asr") ||
    tracks.find((t) => String(t.languageCode || "").startsWith("en")) ||
    tracks[0];

  let baseUrl = pick?.baseUrl;
  if (!baseUrl) return null;
  baseUrl = baseUrl.replace(/[?&]fmt=[^&]+/g, "");
  const capUrl = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "fmt=json3";

  try {
    const capRes = await fetch(capUrl);
    const txt = await capRes.text();
    if (!txt.trim().startsWith("{")) return null;
    const data = JSON.parse(txt);
    const lines = eventsToLines(data?.events);
    return lines.length ? lines : null;
  } catch { return null; }
}

// ===== App URL 管理 =====
async function getAppUrl() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    let url = result[STORAGE_KEY];
    if (!url) {
      url = prompt("请输入你的 LinguaTube 应用地址：\n（例如 https://your-app.base44.com）");
      if (url) {
        url = url.trim().replace(/\/+$/, "");
        await chrome.storage.local.set({ [STORAGE_KEY]: url });
      }
    }
    return url;
  } catch {
    // chrome.storage 不可用时回退到 prompt
    return prompt("请输入你的 LinguaTube 应用地址：");
  }
}

// ===== 获取页面标题（去掉 YouTube / B站 后缀）=====
function getCleanTitle() {
  let t = document.title || "";
  t = t.replace(/\s*-\s*YouTube\s*$/i, "")
       .replace(/\s*_\s*哔哩哔哩.*$/i, "")
       .replace(/\s*-[^-]*哔哩哔哩.*$/i, "")
       .trim();
  return t || "快速导入视频";
}

// ===== 按钮注入 =====
let btnEl = null;

function ensureButton() {
  if (btnEl && document.body.contains(btnEl)) return;
  btnEl = document.createElement("div");
  btnEl.id = "linguatube-float-btn";
  btnEl.innerHTML = `
    <span class="lt-emoji">📚</span>
    <span class="lt-label">导入学习</span>
  `;
  btnEl.style.cssText = `
    position: fixed;
    bottom: 80px;
    right: 24px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 28px;
    background: linear-gradient(135deg, #00e6b3, #00b894);
    color: #0a0b0d;
    font-weight: 700;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(0, 230, 179, 0.4);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    user-select: none;
    -webkit-user-select: none;
    line-height: 1;
  `;
  btnEl.addEventListener("mouseenter", () => {
    btnEl.style.transform = "scale(1.06)";
    btnEl.style.boxShadow = "0 6px 28px rgba(0, 230, 179, 0.55)";
  });
  btnEl.addEventListener("mouseleave", () => {
    btnEl.style.transform = "scale(1)";
    btnEl.style.boxShadow = "0 4px 20px rgba(0, 230, 179, 0.4)";
  });
  btnEl.addEventListener("click", handleClick);
  document.body.appendChild(btnEl);
}

function removeButton() {
  if (btnEl) {
    btnEl.remove();
    btnEl = null;
  }
}

function setButtonLoading(loading, labelText) {
  if (!btnEl) return;
  if (loading) {
    btnEl.innerHTML = `<span class="lt-emoji">⏳</span><span class="lt-label">${labelText || "提取字幕中…"}</span>`;
    btnEl.style.opacity = "0.85";
    btnEl.style.pointerEvents = "none";
  } else {
    btnEl.innerHTML = `<span class="lt-emoji">📚</span><span class="lt-label">导入学习</span>`;
    btnEl.style.opacity = "1";
    btnEl.style.pointerEvents = "auto";
  }
}

// ===== 点击处理：提取字幕 + 跳转 =====
async function handleClick() {
  const appUrl = await getAppUrl();
  if (!appUrl) return;

  setButtonLoading(true);

  try {
    const videoUrl = window.location.href.split("&")[0]; // 去掉多余参数
    const title = getCleanTitle();
    const ytId = extractYouTubeId(videoUrl);

    let subs = null;
    if (ytId) {
      subs = await extractYouTubeSubs(ytId);
    }

    const params = new URLSearchParams();
    params.set("url", videoUrl);
    params.set("title", title);

    if (subs && subs.length > 0) {
      // base64 编码 UTF-8 JSON
      const json = JSON.stringify(subs);
      const b64 = btoa(unescape(encodeURIComponent(json)));
      params.set("subs", b64);
    }

    const targetUrl = appUrl.replace(/\/+$/, "") + "/quick-study?" + params.toString();
    window.open(targetUrl, "_blank");
  } catch (e) {
    alert("导入失败: " + (e?.message || "未知错误"));
  } finally {
    setButtonLoading(false);
  }
}

// ===== SPA 导航检测：YouTube / B站 都是 SPA =====
let lastUrl = "";
function checkUrl() {
  const url = window.location.href;
  if (url === lastUrl) return;
  lastUrl = url;
  if (isVideoPage(url)) {
    ensureButton();
  } else {
    removeButton();
  }
}

// 初始检查 + 定期轮询（SPA 导航不触发 page reload）
checkUrl();
setInterval(checkUrl, 800);
