import { handleAI } from "./ai.js";
import { handleAICredentials } from "./aiCredentialsApi.js";
import { sendCredentialFailure } from "./aiCredentialErrors.js";
import { sendAIError } from "./aiErrorResponse.js";
import { handleYouTubeTranscript } from "./youtubeTranscript.js";
import { fetchDoubanPoster, searchLocalPosters } from "./posterSearch.js";

async function readBody(req) {
  const raw = await readRawBody(req);
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function shouldProxyToProduction(path, method, target) {
  return Boolean(target) && (
    (path === "/api/ai-credentials" && method === "GET")
    || (path === "/api/ai" && method === "POST")
  );
}

function safeProxyDiagnostics(path, status, durationMs, payload) {
  const diagnostic = payload?.diagnostic || {};
  const isAI = path === "/api/ai";
  const upstreamRequestSent = isAI && (
    status < 400
    || Number.isFinite(Number(payload?.upstreamStatus))
    || Number.isFinite(Number(diagnostic?.upstreamStatus))
    || diagnostic?.stage === "upstream"
    || payload?.stage === "upstream"
  );
  console.info("[dev production API proxy]", {
    route: path,
    status,
    credentialLookup: path === "/api/ai-credentials" ? (status < 400 ? "success" : "failed") : undefined,
    credentialDecrypt: isAI ? (upstreamRequestSent ? "success" : payload?.stage === "credential_lookup" || payload?.stage === "encryption" ? "failed" : "unknown") : undefined,
    provider: String(diagnostic?.provider || payload?.provider || "").slice(0, 40) || undefined,
    model: String(diagnostic?.model || payload?.model || "").slice(0, 120) || undefined,
    upstreamRequestSent: isAI ? Boolean(upstreamRequestSent) : undefined,
    upstreamStatus: Number(payload?.upstreamStatus || diagnostic?.upstreamStatus) || null,
    errorStage: String(payload?.stage || diagnostic?.stage || "").slice(0, 60) || undefined,
    elapsedMs: durationMs,
  });
}

function createProductionAiProxy(target, fetchImpl = fetch) {
  if (!target) return null;
  const parsedTarget = new URL(target);
  if (parsedTarget.protocol !== "https:") throw new Error("Production AI API proxy target must use HTTPS");

  return async (req, res) => {
    const path = String(req.url || "").split("?")[0];
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(new URL(req.url, parsedTarget), {
        method: req.method,
        headers: {
          ...(req.headers?.authorization ? { authorization: req.headers.authorization } : {}),
          ...(req.headers?.["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
          ...(req.headers?.accept ? { accept: req.headers.accept } : {}),
        },
        ...(req.method === "GET" ? {} : { body: await readRawBody(req) }),
        redirect: "manual",
      });
      const responseBytes = Buffer.from(await response.arrayBuffer());
      const responseText = responseBytes.toString("utf8");
      let payload;
      try { payload = JSON.parse(responseText); } catch { payload = null; }

      res.statusCode = response.status;
      for (const header of ["content-type", "retry-after"]) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader("Cache-Control", "no-store");
      safeProxyDiagnostics(path, response.status, Date.now() - startedAt, payload);
      res.end(responseBytes);
    } catch {
      const payload = { code: "PRODUCTION_AI_PROXY_FAILED", stage: "proxy", error: "Production AI API 暂时不可达" };
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      safeProxyDiagnostics(path, 502, Date.now() - startedAt, payload);
      res.end(JSON.stringify(payload));
    }
  };
}

function middleware(env, productionAiApiTarget = "", fetchImpl = fetch) {
  const productionAiProxy = createProductionAiProxy(productionAiApiTarget, fetchImpl);
  return async (req, res, next) => {
    const path = String(req.url || "").split("?")[0];
    if (shouldProxyToProduction(path, req.method, productionAiApiTarget)) {
      await productionAiProxy(req, res);
      return;
    }
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

export function localApiPlugin(env, { productionAiApiTarget = "", fetchImpl } = {}) {
  return {
    name: "local-api",
    configureServer(server) { server.middlewares.use(middleware(env, productionAiApiTarget, fetchImpl)); },
    configurePreviewServer(server) { server.middlewares.use(middleware(env)); },
  };
}
