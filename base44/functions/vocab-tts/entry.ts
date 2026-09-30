import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";

// 为复习「听音选拼写」回合合成英文发音 MP3。
// 浏览器内置 TTS(speechSynthesis)在无障碍环境/部分移动端常静默失效,
// 改为服务端 Core.GenerateSpeech 合成稳定可播放的音频链接。
// 客户端可携带已缓存 audio_url 命中后直接回传,跳过合成、节省积分。
export default async function(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const expression = (body?.expression_en || "").toString().trim();
    if (!expression) return Response.json({ error: "缺少 expression_en" }, { status: 400 });
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "未登录" }, { status: 401 });
    // 命中缓存:直接回传客户端已有的播放链接。
    if (body?.audio_url) return Response.json({ audio_url: body.audio_url });
    const res = await base44.asServiceRole.integrations.Core.GenerateSpeech({
      text: expression.slice(0, 2000),
      language_code: "en",
      voice: "river",
    });
    const url = res?.url || res?.audio_url;
    if (!url) return Response.json({ error: "合成失败" }, { status: 502 });
    return Response.json({ audio_url: url });
  } catch (error) {
    return Response.json({ error: error?.message || "生成失败" }, { status: 500 });
  }
}