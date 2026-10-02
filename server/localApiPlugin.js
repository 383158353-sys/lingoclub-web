import { handleAI } from "./ai.js";
import { handleAICredentials } from "./aiCredentialsApi.js";
import { sendCredentialFailure } from "./aiCredentialErrors.js";
import { sendAIError } from "./aiErrorResponse.js";
import { handleYouTubeTranscript } from "./youtubeTranscript.js";
import { fetchDoubanPoster, searchLocalPosters } from "./posterSearch.js";

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function middleware(env) {
  return async (req, res, next) => {
    const path = String(req.url || "").split("?")[0];
    if (path === "/api/poster-search" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      try {
        const url = new URL(req.url, "http://localhost");
        const result = await searchLocalPosters({ query: url.searchParams.get("query"), type: url.searchParams.get("type"), seasonNumber: url.searchParams.get("season") }, env);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: "POSTER_SEARCH_FAILED", message: error?.message || "封面搜索暂时失败" }));
      }
      return;
    }
    if (path === "/api/douban-poster" && req.method === "GET") {
      try {
        const url = new URL(req.url, "http://localhost");
        const { bytes, contentType } = await fetchDoubanPoster(url.searchParams.get("url") || "");
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.statusCode = 200;
        res.end(Buffer.from(bytes));
      } catch (error) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.statusCode = 502;
        res.end(JSON.stringify({ error: "DOUBAN_POSTER_UNAVAILABLE", message: error?.message || "豆瓣封面暂时无法读取" }));
      }
      return;
    }
    if (path === "/api/ai-credentials") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      try {
        const body = req.method === "GET" ? {} : await readBody(req);
        await handleAICredentials(req, res, body, env);
      } catch (error) {
        sendCredentialFailure(res, error, "credential_endpoint");
      }
      return;
    }
    if (req.method !== "POST" || !["/api/ai", "/api/youtube-transcript"].includes(path)) return next();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    let body;
    try {
      body = await readBody(req);
      if (path === "/api/ai") await handleAI(req, res, body, env);
      else await handleYouTubeTranscript(req, res, body, env);
    } catch (error) {
      if (path === "/api/ai") sendAIError(res, error, { task: body?.task, credentialId: body?.credential_id });
      else { res.statusCode = error instanceof SyntaxError ? 400 : 500; res.end(JSON.stringify({ error: error instanceof SyntaxError ? "请求格式无效" : "请求失败" })); }
    }
  };
}

export function localApiPlugin(env) {
  return {
    name: "local-api",
    configureServer(server) { server.middlewares.use(middleware(env)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(env)); },
  };
}
