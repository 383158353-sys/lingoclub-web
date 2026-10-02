export function productionApi(handle, onError) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    let requestBody;
    try {
      requestBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "JSON object required" }));
        return;
      }
      await handle(req, res, requestBody, process.env);
    } catch (error) {
      if (onError) { onError(res, error, requestBody); return; }
      res.statusCode = error instanceof SyntaxError ? 400 : (error?.status >= 400 && error?.status <= 599 ? error.status : 502);
      const upstreamStatus = error?.status;
      if (!(error instanceof SyntaxError) && upstreamStatus) {
        if (upstreamStatus === 401 || upstreamStatus === 403) { res.statusCode = 502; res.end(JSON.stringify({ error: "API Key 无效或没有调用权限", code: "AI_PROVIDER_AUTH" })); return; }
        if (upstreamStatus === 404) { res.statusCode = 502; res.end(JSON.stringify({ error: "模型不可用", code: "AI_MODEL_UNAVAILABLE" })); return; }
        if (upstreamStatus === 429) { res.statusCode = 429; res.end(JSON.stringify({ error: "AI 服务请求过于频繁", code: "AI_RATE_LIMIT" })); return; }
      }
      if (error?.name === "TimeoutError" || error?.name === "AbortError") { res.statusCode = 504; res.end(JSON.stringify({ error: "AI 请求超时", code: "AI_TIMEOUT" })); return; }
      if (error?.code === "AUTH_REQUIRED") { res.statusCode = 401; res.end(JSON.stringify({ error: "请先登录", code: "AUTH_REQUIRED" })); return; }
      const body = error instanceof SyntaxError
        ? { error: "Invalid JSON" }
        : { error: "AI 服务暂时不可用，请稍后重试", code: "AI_REQUEST_FAILED" };
      res.end(JSON.stringify(body));
    }
  };
}
