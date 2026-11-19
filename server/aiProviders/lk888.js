export const LK888_BASE_URL = "https://api.lk888.ai";

export function normalizeLk888RelayCredential(credential) {
  const type = String(credential?.provider_type || credential?.type || "").toLowerCase();
  const baseUrl = credential?.base_url || credential?.baseUrl || "";
  if (type !== "relay") return credential;
  try {
    const url = new URL(String(baseUrl));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "api.lk888.ai") return credential;
  } catch {
    return credential;
  }
  return { ...credential, provider: "openai-compatible", base_url: LK888_BASE_URL, baseUrl: LK888_BASE_URL };
}
