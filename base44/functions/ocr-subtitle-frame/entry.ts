import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// OCR 字幕识别：接收视频帧图片 URL，用 LLM 视觉能力提取画面中的字幕文本。
// 支持四种字幕情况：无字幕、纯中文字幕、纯英文字幕、中英双语字幕。
// 客户端按时间间隔截取视频帧 → UploadFile → 调用本函数 → 返回该帧的字幕文本。
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { file_url, translate = false, language_hint = 'auto' } = body;

    if (!file_url || typeof file_url !== 'string') {
      return Response.json({ error: 'Missing file_url' }, { status: 400 });
    }

    const prompt = `You are an expert OCR assistant specialized in extracting burned-in or overlay subtitles from video frames.

Look at this video frame carefully. Subtitles are typically located at the BOTTOM of the frame (lower 25%), sometimes at the TOP. Look for any text that appears to be subtitle text — it usually has a distinct outline, shadow, or background box compared to the video content.

You must handle ALL possible subtitle scenarios:

1. **No subtitle visible**: The frame has no subtitle text at all. Return empty strings for everything.

2. **Chinese-only subtitles (中文字幕)**: The subtitle text is in Chinese characters (简体/繁体中文). Put the Chinese text in "text_zh". Put the same Chinese text in "text" as well (so it's never empty). Set language to "zh".

3. **English-only subtitles**: The subtitle text is in English/Latin characters. Put it in "text". Set language to "en". If translate=true, also provide a natural Chinese translation in "text_zh".

4. **Bilingual subtitles (中英双语)**: The frame shows BOTH Chinese and English subtitle text (e.g. English on top, Chinese below, or side by side). Put the English text in "text", the Chinese text in "text_zh". Set language to "bilingual".

Rules:
- Extract the subtitle text EXACTLY as it appears (preserve punctuation, capitalization, and line breaks within the subtitle).
- Do NOT extract text that is part of the video content itself (e.g. street signs, on-screen graphics, channel logos) — ONLY actual subtitle/caption text.
- If there are multiple subtitle lines, join them with a space or newline as they appear.
- If there is genuinely NO subtitle text visible, return empty string for "text" and "text_zh".
- For Chinese-only subtitles where translate=true, "text_zh" is already the Chinese — just return it as-is (no translation needed).
- Language hint: the subtitle might be in "${language_hint}" language, but always detect and report what you actually see.

Return a JSON object with:
- "text": the primary subtitle text (English for bilingual/English-only; Chinese for Chinese-only; empty string if no subtitle)
- "text_zh": the Chinese text (Chinese for bilingual/Chinese-only; translated Chinese if translate=true and English-only; empty string if no subtitle or translate=false and English-only)
- "language": detected subtitle type — one of: "en", "zh", "bilingual", "" (empty if no subtitle)`;

    const schemaProps = {
      text: { type: 'string' },
      text_zh: { type: 'string' },
      language: { type: 'string' },
    };

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      file_urls: [file_url],
      response_json_schema: {
        type: 'object',
        properties: schemaProps,
        required: ['text', 'text_zh', 'language'],
      },
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}