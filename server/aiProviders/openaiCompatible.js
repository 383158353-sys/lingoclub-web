export function normalizeOpenAICompatibleEndpoint(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (clean.endsWith("/chat/completions")) return clean;
  const versioned = /\/v\d+(?:alpha\d*|beta\d*)?$/i.test(clean) ? clean : `${clean}/v1`;
  return `${versioned}/chat/completions`;
}

export function openAICompatibleRequest(baseUrl, apiKey, model, prompt, { jsonResponse = true } = {}) {
  const body = { model, messages: [{ role: "user", content: prompt }] };
  if (jsonResponse) Object.assign(body, { temperature: 0.2, response_format: { type: "json_object" } });
  return {
    url: normalizeOpenAICompatibleEndpoint(baseUrl),
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

export function readOpenAICompatibleResponse(raw) { return raw?.choices?.[0]?.message?.content || ""; }
