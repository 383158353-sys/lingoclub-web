import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// AI 一键生成封面：根据片名/标语/简介，并行生成竖版海报 (2:3) 与横版推荐图 (16:9)。
// 鉴权：必须登录；Core.GenerateImage 走 service role。
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = (body.title || '').toString().trim();
    const tagline = (body.tagline || '').toString().trim();
    const description = (body.description || '').toString().trim().slice(0, 160);

    if (!title) return Response.json({ error: 'title is required' }, { status: 400 });

    const tag = tagline ? `标语：「${tagline}」。` : '';
    const desc = description ? `故事背景：${description}。` : '';

    const posterPrompt = `设计一张电影海报（cinematic movie poster, 2:3 竖版 one-sheet）。
主题作品：《${title}》。${tag}${desc}
要求：
- 完整的电影海报排版设计感：主视觉艺术图 + 顶部或底部预留标题排版空间。
- 强光影、电影级调色、戏剧化构图，画面四周自然留白便于叠加文字。
- 不要在画面中渲染任何中文字、字母或文字标题，仅绘制图像与构图留白。
- 高品质，电影宣传物料质感。`;

    const backdropPrompt = `设计一张推荐页横幅图（16:9 wide cinematic key art / feature banner）。
主题作品：《${title}》。${tag}${desc}
要求：
- 宽屏电影剧照式构图，氛围浓厚、画面留有横向叠字区。
- 电影级调色，光影戏剧化，适合作为首页推荐位大图直接使用。
- 不要在画面中渲染任何中文/英文字或标题。
- 单帧电影质感，强烈代入感。`;

    const [poster, backdrop] = await Promise.all([
      base44.asServiceRole.integrations.Core.GenerateImage({ prompt: posterPrompt }),
      base44.asServiceRole.integrations.Core.GenerateImage({ prompt: backdropPrompt }),
    ]);

    return Response.json({
      poster_url: poster?.url || '',
      backdrop_url: backdrop?.url || poster?.url || '',
    });
  } catch (error) {
    console.error('ai-cover-generate error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}