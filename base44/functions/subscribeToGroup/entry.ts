import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 订阅小组：将公开小组（Movie）中的所有视频克隆到用户的 LocalStudyLibrary
// 1. 读取 Movie + 关联的 Episode（含字幕）
// 2. 在用户库中创建同名 StudyFolder（若已存在则跳过创建）
// 3. 为每个 Episode 创建 LocalMovieMeta（含 video_url + subtitles）
// 4. 创建/更新 Subscription 记录
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const movieId = body.movie_id;
    if (!movieId) return Response.json({ error: '缺少 movie_id' }, { status: 400 });

    // 读取 Movie
    const movie = await base44.entities.Movie.get(movieId);
    if (!movie) return Response.json({ error: '小组不存在' }, { status: 404 });

    // 检查是否已订阅
    const existing = await base44.entities.Subscription.filter({ movie_id: movieId });
    if (existing && existing.length > 0 && existing[0].status === 'active') {
      // 已订阅：返回已有文件夹信息
      const folderName = existing[0].movie_title || movie.title;
      const existingFolder = await base44.entities.StudyFolder.filter({ name: folderName, tab_type: 'videos' });
      return Response.json({
        ok: true,
        already_subscribed: true,
        folder_id: existingFolder[0]?.id || null,
        message: '已订阅过该小组',
      });
    }

    // 读取 Episode 列表
    const episodes = await base44.entities.Episode.filter({ movie_id: movieId });
    if (!episodes || episodes.length === 0) {
      return Response.json({ error: '该小组暂无视频内容' }, { status: 400 });
    }

    // 创建同名文件夹，并记录 movie_id 以便后续同步新视频
    const folder = await base44.entities.StudyFolder.create({
      name: movie.title,
      tab_type: 'videos',
      sort_order: Date.now(),
      movie_id: movieId,
    });

    // 为每个 Episode 创建 LocalMovieMeta
    const metas = await base44.entities.LocalMovieMeta.bulkCreate(
      episodes.map((ep, i) => ({
        name: ep.title || `第 ${i + 1} 集`,
        video_url: ep.video_url || '',
        poster_url: '',
        folder: folder.id,
        sort_order: i * 10,
        subtitles: [],
      }))
    );

    // 把每个 Episode 的字幕加载到对应的 LocalMovieMeta
    for (let i = 0; i < episodes.length; i++) {
      const subs = await base44.entities.Subtitle.filter({ episode_id: episodes[i].id });
      if (subs && subs.length > 0) {
        const mapped = subs.map((s) => ({
          id: s.id,
          text_en: s.text_en || '',
          text_zh: s.text_zh || '',
          time_start: s.time_start || '',
          time_end: s.time_end || '',
          timestamp: s.timestamp || '',
          order: s.order || 0,
        }));
        await base44.entities.LocalMovieMeta.update(metas[i].id, { subtitles: mapped });
      }
    }

    // 创建 Subscription 记录
    await base44.entities.Subscription.create({
      movie_id: movieId,
      movie_title: movie.title,
      tier: 'free',
      status: 'active',
      start_date: new Date().toISOString(),
      order: Date.now(),
    });

    // 更新 Movie member_count
    const count = (movie.member_count || 0) + 1;
    await base44.entities.Movie.update(movieId, { member_count: count });

    return Response.json({
      ok: true,
      folder_id: folder.id,
      video_count: episodes.length,
      message: `已订阅「${movie.title}」，${episodes.length} 个视频已导入你的库`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}