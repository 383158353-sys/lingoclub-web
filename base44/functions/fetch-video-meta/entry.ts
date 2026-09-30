// 获取 YouTube 视频的原始标题和缩略图（oEmbed 公开 API，无需 API Key）。
// 导入视频时前端调用此函数自动填充标题与封面。
export default async function(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const url = body?.url;
    if (!url) return Response.json({ error: '缺少 url 参数' }, { status: 400 });

    const ytMatch = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!ytMatch) return Response.json({ error: '暂仅支持 YouTube 链接自动获取标题' }, { status: 400 });

    const videoId = ytMatch[1];
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    if (!oembedRes.ok) return Response.json({ error: '获取视频信息失败' }, { status: 502 });
    const data = await oembedRes.json();

    return Response.json({
      title: data.title || '',
      author: data.author_name || '',
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}