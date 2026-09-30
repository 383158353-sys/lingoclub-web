import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 同步视频到已发布的小组：
// 仅文件夹所有者调用。文件夹必须已发布（is_shared + movie_id）。
// action="add": 将 LocalMovieMeta 对应的视频创建为 Episode + Subtitles
// action="remove": 删除对应的 Episode + Subtitles
export default async function syncVideoToGroup(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { folder_id, meta_id, action } = body;
    if (!folder_id || !meta_id || !action) {
      return Response.json({ error: '缺少参数' }, { status: 400 });
    }

    const folder = await base44.entities.StudyFolder.get(folder_id);
    if (!folder) return Response.json({ error: '文件夹不存在' }, { status: 404 });

    // 只有文件夹所有者（或管理员）可以同步到公开小组
    if (folder.created_by_id !== user.id && user.role !== 'admin') {
      return Response.json({ error: '只有所有者可以同步视频到公开小组' }, { status: 403 });
    }

    // 文件夹必须已发布
    if (!folder.is_shared || !folder.movie_id) {
      return Response.json({ error: '文件夹尚未发布为小组' }, { status: 400 });
    }

    const meta = await base44.entities.LocalMovieMeta.get(meta_id);
    if (!meta) return Response.json({ error: '视频不存在' }, { status: 404 });

    if (action === 'add') {
      // 检查是否已存在同 video_url 的 Episode（避免重复）
      if (meta.video_url) {
        const existing = await base44.entities.Episode.filter({ movie_id: folder.movie_id, video_url: meta.video_url });
        if (existing && existing.length > 0) {
          return Response.json({ ok: true, already_exists: true, episode_id: existing[0].id });
        }
      }

      // 获取当前最大 order
      const allEps = await base44.entities.Episode.filter({ movie_id: folder.movie_id }, 'order', 500);
      const maxOrder = allEps && allEps.length > 0 ? Math.max(...allEps.map((e) => e.order || 0)) : 0;
      const epNum = maxOrder + 10;

      // 创建 Episode
      const ep = await base44.entities.Episode.create({
        movie_id: folder.movie_id,
        title: meta.name || `第 ${epNum / 10} 集`,
        video_url: meta.video_url || '',
        episode_number: epNum / 10,
        episode: String(epNum / 10),
        order: epNum,
        duration: 0,
        scene_count: 0,
        contribution_status: 'approved',
      });

      // 创建 Subtitles
      const subs = meta.subtitles || [];
      if (subs.length > 0) {
        await base44.entities.Subtitle.bulkCreate(
          subs.map((s, i) => ({
            movie_id: folder.movie_id,
            episode_id: ep.id,
            text_en: s.text_en || '',
            text_zh: s.text_zh || '',
            time_start: s.time_start || '',
            time_end: s.time_end || '',
            timestamp: s.timestamp || s.time_start || '',
            order: s.order ?? i,
          }))
        );
      }

      // 更新 Movie total_episodes
      const movie = await base44.entities.Movie.get(folder.movie_id);
      if (movie) {
        await base44.entities.Movie.update(folder.movie_id, {
          total_episodes: (movie.total_episodes || 0) + 1,
        });
      }

      return Response.json({ ok: true, episode_id: ep.id, subtitle_count: subs.length });
    }

    if (action === 'remove') {
      // 找到对应的 Episode（按 video_url 匹配）
      if (!meta.video_url) {
        return Response.json({ ok: true, removed: 0 });
      }
      const eps = await base44.entities.Episode.filter({ movie_id: folder.movie_id, video_url: meta.video_url });
      if (eps && eps.length > 0) {
        for (const ep of eps) {
          await base44.entities.Subtitle.deleteMany({ episode_id: ep.id });
          await base44.entities.Episode.delete(ep.id);
        }
        const movie = await base44.entities.Movie.get(folder.movie_id);
        if (movie) {
          await base44.entities.Movie.update(folder.movie_id, {
            total_episodes: Math.max(0, (movie.total_episodes || 0) - eps.length),
          });
        }
      }
      return Response.json({ ok: true, removed: eps?.length || 0 });
    }

    return Response.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}