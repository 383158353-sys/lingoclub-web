const OFFICIAL_OPENAI_BASE = "https://api.openai.com/v1";

export function openAIResponsesEndpoint() {
  return `${OFFICIAL_OPENAI_BASE}/responses`;
}

export function openAIResponsesRequest(apiKey, model, input, { minimal = false } = {}) {
  return {
    url: openAIResponsesEndpoint(),
    options: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input,
        ...(minimal ? {} : { text: { format: { type: "json_object" } } }),
      }),
    },
  };
}

export function readOpenAIResponsesResponse(raw) {
  if (typeof raw?.output_text === "string" && raw.output_text.trim()) return raw.output_text;
  const parts = [];
  for (const item of Array.isArray(raw?.output) ? raw.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("");
}
