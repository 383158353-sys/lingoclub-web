// 精读（translate_sentence）请求：超时预算、一次自动重试、清晰的错误说明。
//
// 预算必须与服务端对齐：/api/ai 跑在 Vercel 上 maxDuration=60s（vercel.json），
// 服务端对中转站单次请求最多等 CLOSE_READING_UPSTREAM_TIMEOUT_MS，并在 55s 预算内
// 才会重试。客户端要比服务端多等一点，才能收到服务端的真实错误（例如上游 HTTP
// 状态），而不是自己先放弃。以前客户端 26s 就判定「精读超时」，而服务端
// 25s×2 次重试最长要 50s，慢模型几乎每次都被客户端提前掐断。
export const CLOSE_READING_UPSTREAM_TIMEOUT_MS = 50_000;
export const CLOSE_READING_CLIENT_TIMEOUT_MS = 58_000;

export function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.code === "REQUEST_TIMEOUT" || error?.code === "TIMEOUT" || Number(error?.status) === 504;
}

// 只对「很快失败」的临时错误自动重试一次；超时已经等了近一分钟，不再自动重试。
export function isTransientCloseReadingError(error) {
  if (!error || isTimeoutError(error)) return false;
  if (["AUTH_REQUIRED", "AI_NOT_CONFIGURED", "AI_ROUTE_NOT_CONFIGURED", "AUTH_ERROR", "MODEL_NOT_AVAILABLE", "BILLING_OR_QUOTA_ERROR", "REQUEST_FORMAT_ERROR", "AI_SERVER_NOT_CONFIGURED"].includes(error.code)) return false;
  if (["EMPTY_ANALYSIS", "UPSTREAM_EMPTY_RESPONSE", "UPSTREAM_OK_PARSE_FAILED", "NETWORK_ERROR"].includes(error.code)) return true;
  if (error instanceof TypeError) return true; // fetch 网络错误
  const status = Number(error.status) || 0;
  return status === 429 || status >= 500;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestCloseReading(invoke, payload, { timeoutMs = CLOSE_READING_CLIENT_TIMEOUT_MS, retries = 1, retryDelayMs = 800, sleep = defaultSleep, onRetry } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await invoke("translate_sentence", payload, { timeoutMs });
      const analysis = res?.analysis;
      if (!analysis || typeof analysis !== "object") throw Object.assign(new Error("解析未返回内容"), { code: "EMPTY_ANALYSIS" });
      return analysis;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientCloseReadingError(error)) throw error;
      try { onRetry?.(error, attempt + 1); } catch { /* UI hook only */ }
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

function detailSuffix(error) {
  const parts = [];
  const status = Number(error?.status) || 0;
  const upstreamStatus = Number(error?.upstreamStatus) || 0;
  if (status) parts.push(`HTTP ${status}`);
  if (upstreamStatus && upstreamStatus !== status) parts.push(`上游 ${upstreamStatus}`);
  const upstreamMessage = String(error?.upstreamMessage || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const head = parts.join(" · ");
  if (!head && !upstreamMessage) return "";
  return `（${head}${head && upstreamMessage ? "：" : ""}${upstreamMessage}）`;
}

export function describeCloseReadingError(error) {
  const model = error?.model ? `模型 ${error.model} ` : "当前模型";
  if (error?.code === "REQUEST_TIMEOUT" || (error?.name === "TimeoutError" && !error?.status)) {
    const seconds = Math.round((Number(error?.timeoutMs) || CLOSE_READING_CLIENT_TIMEOUT_MS) / 1000);
    return { title: "精读超时", timeout: true, description: `等了 ${seconds} 秒仍没有结果：${model}响应太慢或中转站拥堵。可点「重试解析」，或到「AI 设置」换一个更快的模型。` };
  }
  if (isTimeoutError(error)) {
    const serverMessage = String(error?.message || "").trim();
    const reason = serverMessage && !/^(请求超时|服务暂时不可用|Request timed out)$/.test(serverMessage) ? serverMessage : `中转站在规定时间内没有返回结果（${model}可能太慢）`;
    return { title: "精读超时", timeout: true, description: `${reason}。可点「重试解析」，或到「AI 设置」换一个更快的模型。` };
  }
  const message = error?.response?.data?.error || error?.message || "解析失败";
  return { title: "AI 解析失败", timeout: false, description: `${message}${detailSuffix(error)}` };
}
