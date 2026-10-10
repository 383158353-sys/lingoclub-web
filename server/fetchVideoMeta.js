// 获取 YouTube 视频的原始标题和缩略图（oEmbed 公开 API，无需 API Key）。
// 导入视频时前端调用此函数自动填充标题与封面。
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export async function handleFetchVideoMeta(_req, res, body = {}) {
  try {
    const url = body?.url;
    if (!url) return sendJson(res, 400, { error: '缺少 url 参数' });

    const ytMatch = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!ytMatch) return sendJson(res, 400, { error: '暂仅支持 YouTube 链接自动获取标题' });

    const videoId = ytMatch[1];
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    if (!oembedRes.ok) return sendJson(res, 502, { error: '获取视频信息失败' });
    const data = await oembedRes.json();

    return sendJson(res, 200, {
      title: data.title || '',
      author: data.author_name || '',
      thumbnail_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}
