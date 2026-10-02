function cleanProviderMessage(value, secret = "") {
  let message = String(value || "").slice(0, 500);
  if (secret) message = message.split(secret).join("[redacted]");
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|AIza)[-_][A-Za-z0-9._-]{12,}\b/g, "[redacted]");
}

export function classifyAIError(error) {
  const status = Number(error?.status) || 0;
  const message = cleanProviderMessage(error?.providerMessage || error?.message || "");
  const upstreamCode = /^[A-Za-z0-9_.-]{1,100}$/.test(String(error?.providerCode || "")) ? String(error.providerCode) : undefined;
  const providerType = error?.providerType || (error?.officialGemini ? "official" : "relay");
  const provider = error?.provider || (error?.officialGemini ? "gemini" : "openai-compatible");
  const diagnosticCode = (code, responseStatus = status || undefined) => ({
    providerType, provider, endpoint: error?.endpoint || "", model: error?.model || "",
    httpStatus: Number(error?.upstreamStatus || status || responseStatus) || responseStatus, ...(upstreamCode ? { upstreamCode } : {}),
    ...(Number(error?.upstreamStatus || status) ? { upstreamStatus: Number(error?.upstreamStatus || status) } : {}),
    ...(message ? { upstreamMessage: cleanProviderMessage(message) } : {}),
    responseShape: error?.responseShape || "none", errorCategory: code,
  });
  if (error?.code === "GEMINI_MODELS_UNAVAILABLE") return { status: 502, code: "AUTH_ERROR", error: "Gemini API Key 无效或无法访问模型列表", stage: "models", upstreamStatus: Number(error?.upstreamStatus) || undefined, upstreamCode, endpoint: error?.endpoint, modelsEndpoint: error?.endpoint, diagnostic: diagnosticCode("AUTH_ERROR", 502) };
  if (error?.code === "GEMINI_MODELS_TIMEOUT") return { status: 504, code: "TIMEOUT", error: "Gemini 模型列表请求超时", stage: "models", endpoint: error?.endpoint, modelsEndpoint: error?.endpoint, diagnostic: diagnosticCode("TIMEOUT", 504) };
  if (error?.code === "UPSTREAM_EMPTY_RESPONSE" || error?.code === "GEMINI_NO_TEXT_CANDIDATE") return { status: 502, code: "UPSTREAM_EMPTY_RESPONSE", error: "AI 上游返回了空响应", stage: "response", endpoint: error?.endpoint, diagnostic: diagnosticCode("UPSTREAM_EMPTY_RESPONSE", 502) };
  if (error?.code === "GEMINI_TEXT_MODEL_REQUIRED") return { status: 400, code: "GEMINI_TEXT_MODEL_REQUIRED", error: "该模型用于语音生成或未返回文本，不能用于文本分析；请选择文本输出模型", stage: "model_validation", endpoint: error?.endpoint, diagnostic: diagnosticCode("GEMINI_TEXT_MODEL_REQUIRED", 400) };
  if (error?.code === "AUTH_REQUIRED" || status === 401 && error?.stage === "auth") return { status: 401, code: "AUTH_REQUIRED", error: "请先登录", stage: "auth" };
  if (error?.code === "AI_NOT_CONFIGURED") return { status: 503, code: "AI_NOT_CONFIGURED", error: "AI 配置尚未完成", stage: "credential_lookup" };
  if (error?.timeout || error?.name === "TimeoutError" || error?.name === "AbortError") return { status: 504, code: "TIMEOUT", error: "请求超时", stage: "upstream", diagnostic: diagnosticCode("TIMEOUT", 504) };
  if (!status && error?.code !== "AI_CREDENTIAL_INVALID") return { status: 502, code: "NETWORK_ERROR", error: "无法连接 AI 服务，请检查网络或服务地址", stage: "upstream", diagnostic: diagnosticCode("NETWORK_ERROR", 502) };
  if (status === 401 || status === 403) return { status: 502, code: "AUTH_ERROR", error: provider === "gemini" ? "Gemini API Key 无效或没有调用权限" : "API Key 无效或没有调用权限", stage: "upstream", upstreamStatus: status, upstreamCode, diagnostic: diagnosticCode("AUTH_ERROR", 502) };
  if (error?.code === "MODEL_NOT_AVAILABLE") return { status: 409, code: "MODEL_NOT_AVAILABLE", error: error.message || "当前 API Key 无权使用此模型", stage: "models", endpoint: error?.endpoint, diagnostic: diagnosticCode("MODEL_NOT_AVAILABLE", 409) };
  if (status === 404) {
    const modelMissing = /model.{0,80}(not found|does not exist|unknown|unavailable)|(?:not found|does not exist|unknown).{0,80}model/i.test(`${upstreamCode || ""} ${message}`);
    const code = modelMissing ? "MODEL_NOT_AVAILABLE" : "ENDPOINT_NOT_FOUND";
    return { status: 502, code, error: modelMissing ? "当前模型不存在或无权使用" : provider === "gemini" ? "Gemini 官方接口返回 404" : "上游接口返回 404", stage: "upstream", upstreamStatus: status, upstreamCode, diagnostic: diagnosticCode(code, 502) };
  }
  if (status === 402 || /billing|quota|insufficient[_ -]?(fund|credit)|payment required/i.test(message)) return { status: 502, code: "BILLING_OR_QUOTA_ERROR", error: "API 额度或账单状态异常", stage: "upstream", upstreamStatus: status || undefined, upstreamCode, diagnostic: diagnosticCode("BILLING_OR_QUOTA_ERROR", 502) };
  if (status === 429) return { status: 429, code: "HTTP_429", error: "API 请求达到速率或额度限制", stage: "upstream", upstreamStatus: status, upstreamCode, diagnostic: diagnosticCode("HTTP_429", 429) };
  if (error?.code === "UPSTREAM_OK_PARSE_FAILED") return { status: 502, code: "UPSTREAM_OK_PARSE_FAILED", error: "上游返回成功，但响应内容无法解析", stage: "parse", diagnostic: diagnosticCode("UPSTREAM_OK_PARSE_FAILED", 502) };
  if (status === 400 || status === 422) {
    const code = error?.code === "UPSTREAM_OK_PARSE_FAILED" ? "UPSTREAM_OK_PARSE_FAILED" : "REQUEST_FORMAT_ERROR";
    return { status: 502, code, error: message || "上游拒绝了当前请求格式", stage: "upstream", upstreamStatus: status, upstreamCode, diagnostic: diagnosticCode(code, 502) };
  }
  if (status >= 500) return { status: 502, code: `HTTP_${status}`, error: provider === "gemini" ? "Gemini 服务暂时不可用" : provider === "openai" ? "OpenAI 服务暂时不可用" : "中转站服务暂时不可用", stage: "upstream", upstreamStatus: status, upstreamCode, diagnostic: diagnosticCode(`HTTP_${status}`, 502) };
  if (error?.code === "SERVER_ENV_MISSING" || error?.code === "AI_CREDENTIALS_NOT_CONFIGURED") return { status: 503, code: "AI_SERVER_NOT_CONFIGURED", error: "AI 服务端配置未完成", stage: "server_config" };
  return { status: 502, code: "NETWORK_ERROR", error: "AI 请求失败", stage: error?.stage || "request", ...(upstreamCode ? { upstreamCode } : {}), diagnostic: diagnosticCode("NETWORK_ERROR", 502) };
}

function safeLogEndpoint(value) {
  try { const url = new URL(String(value || "")); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
  catch { return ""; }
}

function safeLogMessage(value) {
  return String(value || "").slice(0, 400).replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/\b(?:sk|rk|AIza)[-_][A-Za-z0-9._-]{12,}\b/g, "[redacted]").replace(/[\r\n\t]+/g, " ");
}

export function sendAIError(res, error, context = {}) {
  const failure = classifyAIError(error);
  if (process.env.NODE_ENV === "development") {
    console.error("[/api/ai] request failed", {
      task: String(context.task || "").slice(0, 80),
      credentialId: String(context.credentialId || "").slice(0, 120),
      providerType: String(error?.providerType || "").slice(0, 30),
      provider: String(error?.provider || "").slice(0, 60),
      model: String(error?.model || "").slice(0, 120),
      endpoint: safeLogEndpoint(error?.endpoint),
      httpStatus: failure.status,
      upstreamStatus: Number(error?.upstreamStatus || error?.status) || null,
      upstreamCode: /^[A-Za-z0-9_.-]{1,100}$/.test(String(error?.providerCode || "")) ? String(error.providerCode) : null,
      upstreamMessage: safeLogMessage(error?.providerMessage),
      durationMs: Number.isFinite(Number(error?.durationMs)) ? Number(error.durationMs) : null,
      timeout: Boolean(error?.timeout || error?.name === "TimeoutError" || error?.name === "AbortError"),
      aborted: Boolean(error?.aborted || error?.name === "AbortError"),
      parseFailed: error?.code === "UPSTREAM_OK_PARSE_FAILED",
      candidateTextLength: Number.isFinite(Number(error?.candidateTextLength)) ? Number(error.candidateTextLength) : null,
      errorCode: failure.code,
    });
  }
  res.statusCode = failure.status;
  res.end(JSON.stringify(failure));
}
