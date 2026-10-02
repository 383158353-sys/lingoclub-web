export function normalizeGeminiBaseUrl(baseUrl) {
  return String(baseUrl || "https://generativelanguage.googleapis.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1beta$/i, "");
}

export function geminiModelsEndpoint(baseUrl) {
  return `${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models`;
}

export function geminiEndpoint(baseUrl, model) {
  return `${normalizeGeminiBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function geminiRequest(baseUrl, apiKey, model, prompt, schema, { minimal = false, includeThinkingConfig = true } = {}) {
  const generationConfig = minimal ? undefined : {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: schema,
    ...(includeThinkingConfig ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
  };
  return {
    url: geminiEndpoint(baseUrl, model),
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], ...(generationConfig ? { generationConfig } : {}) }),
    },
  };
}

export function readGeminiResponse(raw) { return raw?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || ""; }
