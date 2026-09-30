import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Analyzes an English subtitle line and returns a structured language lesson.
// Narrow operation: validates input, uses one LLM call with a fixed JSON schema,
// bounds absurd input length. No secrets needed — uses Core.InvokeLLM.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    // 精读对所有访客开放（含游客）：仅做一次 LLM 调用，无用户数据写入，
    // 缓存写库由前端按 RLS 自行处理（游客写不进则静默失败，不影响展示）。
    const body = await req.json().catch(() => ({}));
    const textEn = (body.text_en || '').toString().trim();
    const speaker = (body.speaker || '').toString().trim();
    const context = (body.context || '').toString().trim();

    if (!textEn) return Response.json({ error: 'text_en is required' }, { status: 400 });
    if (textEn.length > 600) return Response.json({ error: 'text too long' }, { status: 400 });

    const prompt = `Translate and analyze this English subtitle for a Chinese learner.

Subtitle: "${textEn}"
Speaker: ${speaker || 'unknown'}

Return strict JSON only:
- translation: natural Chinese translation of the whole line
- words: up to 3 key vocabulary items [{word, phonetic, pos, meaning}]; skip trivial words (the/a/is/are/of/to/and); pick idiomatic or advanced words
- phrases: up to 2 key phrases [{phrase, meaning}]
- grammar: one short Chinese sentence on the grammatical structure
- cultural: one short Chinese sentence on cultural/pragmatic nuance

Keep all Chinese fields concise. No commentary.`;

    // 使用 automatic 默认模型——精读 JSON 结构较复杂，mini 模型生成不稳定且易超时。
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          translation: { type: 'string' },
          words: { type: 'array', items: { type: 'object', properties: {
            word: { type: 'string' }, phonetic: { type: 'string' }, pos: { type: 'string' }, meaning: { type: 'string' }
          } } },
          phrases: { type: 'array', items: { type: 'object', properties: {
            phrase: { type: 'string' }, meaning: { type: 'string' }
          } } },
          grammar: { type: 'string' },
          cultural: { type: 'string' }
        }
      }
    });

    return Response.json({ analysis: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}