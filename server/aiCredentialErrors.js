const SAFE_MESSAGES = Object.freeze({
  auth: "当前登录身份验证失败",
  credential_endpoint: "API 配置请求无效",
  missing_server_env: "服务端缺少 Supabase 或凭据加密配置",
  encryption: "API Key 加密失败或加密密钥未配置",
  supabase_connection: "无法连接 Supabase",
  missing_table: "Supabase 缺少 AI 凭据数据表，请先应用 migration",
  rls_permission: "Supabase 拒绝访问 AI 凭据表，请检查 RLS / service role 权限",
  insert_update: "Supabase 写入 AI 凭据失败",
});

export function classifyCredentialFailure(error, fallbackStage = "insert_update") {
  if (error?.stage && SAFE_MESSAGES[error.stage]) return { stage: error.stage, code: error.code || `AI_CREDENTIAL_${error.stage.toUpperCase()}`, message: SAFE_MESSAGES[error.stage], status: error.status || 503 };

  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  if (code === "AUTH_REQUIRED" || error?.status === 401) return { stage: "auth", code: "AUTH_REQUIRED", message: SAFE_MESSAGES.auth, status: 401 };
  if (code === "SERVER_ENV_MISSING" || code === "AI_CREDENTIALS_NOT_CONFIGURED") return { stage: "missing_server_env", code: "SERVER_ENV_MISSING", message: SAFE_MESSAGES.missing_server_env, status: 503 };
  if (code === "ENCRYPTION_FAILED" || code === "ENCRYPTION_KEY_MISSING") return { stage: "encryption", code: "ENCRYPTION_FAILED", message: SAFE_MESSAGES.encryption, status: 503 };
  if (["42P01", "PGRST205", "PGRST204"].includes(code) || /relation .* does not exist|could not find the table|schema cache/.test(message)) return { stage: "missing_table", code: "AI_CREDENTIAL_TABLE_MISSING", message: SAFE_MESSAGES.missing_table, status: 503 };
  if (code === "42501" || error?.status === 403 || /row-level security|permission denied|not allowed/.test(message)) return { stage: "rls_permission", code: "AI_CREDENTIAL_PERMISSION_DENIED", message: SAFE_MESSAGES.rls_permission, status: 403 };
  if (/fetch failed|network|socket|connection|timeout|econn/.test(message) || error?.name === "TypeError") return { stage: "supabase_connection", code: "SUPABASE_CONNECTION_FAILED", message: SAFE_MESSAGES.supabase_connection, status: 503 };
  const stage = SAFE_MESSAGES[fallbackStage] ? fallbackStage : "insert_update";
  return { stage, code: `AI_CREDENTIAL_${stage.toUpperCase()}`, message: SAFE_MESSAGES[stage], status: error?.status >= 400 && error.status <= 599 ? error.status : 503 };
}

export function credentialDiagnosticCategory(error) {
  const message = String(error?.message || "").toLowerCase();
  if (/invalid api key|api key.*invalid/.test(message)) return "invalid_api_key";
  if (/invalid jwt|jwt.*invalid|bad_jwt/.test(message)) return "invalid_jwt";
  if (/relation .* does not exist|could not find the table|schema cache/.test(message)) return "missing_table";
  if (/row-level security|permission denied|not allowed/.test(message)) return "permission_denied";
  if (/fetch failed|network|socket|connection|timeout|econn/.test(message) || error?.name === "TypeError") return "connection_failed";
  return "unknown";
}

export function sendCredentialFailure(res, error, fallbackStage) {
  const failure = classifyCredentialFailure(error, fallbackStage);
  res.statusCode = failure.status;
  res.end(JSON.stringify({ code: failure.code, stage: failure.stage, error: failure.message }));
}
