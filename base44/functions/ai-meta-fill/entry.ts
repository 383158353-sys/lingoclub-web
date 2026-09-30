import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// AI 一键补全项目元信息：根据中文片名，让 LLM 回填 title_en / tagline / description。
// 鉴权：必须登录；Core.InvokeLLM 走 service role。
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = (body.title || '').toString().trim();

    if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
    if (title.length > 200) return Response.json({ error: 'title too long' }, { status: 400 });

    const prompt = `请为影视学习小组补全元信息，中文片名为：「${title}」。
- title_en：贴切且地道的英文片名（若无官方译名则意译/音译给出）；
- tagline：一句中文标语，30 字以内，富有电影感、能勾起好奇；
- description：中文简介，80-150 字，介绍作品时氛围与作为语言学习素材的价值。
仅返回 JSON。`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          title_en: { type: 'string' },
          tagline: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title_en', 'tagline', 'description'],
      },
    });

    return Response.json({ title_en: result.title_en || '', tagline: result.tagline || '', description: result.description || '' });
  } catch (error) {
    console.error('ai-meta-fill error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}