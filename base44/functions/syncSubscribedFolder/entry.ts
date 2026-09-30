import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 订阅者打开库时自动同步：将公开视频单（Movie）中的最新 Episode 同步到自己的文件夹。
// 1. 读取订阅者的 StudyFolder（须有 movie_id，即通过 subscribeToGroup 创建的文件夹）
// 2. 读取 Movie 关联的所有 Episode（公开可读）
// 3. 读取该文件夹中已有的 LocalMovieMeta（按 video_url 去重）
// 4. 为缺失的 Episode 创建 LocalMovieMeta（含字幕），不复制 Movie 海报
// 5. 已有 Episode 的字幕如有变化也同步更新
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const folderId = body.folder_id;
    if (!folderId) return Response.json({ error: '缺少 folder_id' }, { status: 400 });

    const folder = await base44.entities.StudyFolder.get(folderId);
    if (!folder) return Response.json({ error: '文件夹不存在' }, { status: 404 });
    if (!folder.movie_id) return Response.json({ ok: true, synced: 0, message: '非订阅文件夹' });

    // 读取 Movie 的所有 Episode
    const episodes = await base44.entities.Episode.filter({ movie_id: folder.movie_id }, 'order', 500);
    if (!episodes || episodes.length === 0) {
      return Response.json({ ok: true, synced: 0, message: '视频单暂无视频' });
    }

    // 读取文件夹中已有的 LocalMovieMeta
    const existingMetas = await base44.entities.LocalMovieMeta.filter({ folder: folderId });
    const metaByUrl = new Map();
    for (const m of existingMetas) {
      if (m.video_url) metaByUrl.set(m.video_url, m);
    }

    // 找出需要新建的 Episode（video_url 不在已有 LocalMovieMeta 中）
    const newEpisodes = episodes.filter(ep => ep.video_url && !metaByUrl.has(ep.video_url));

    let created = 0;
    if (newEpisodes.length > 0) {
      const startOrder = existingMetas.length > 0
        ? Math.max(...existingMetas.map(m => m.sort_order || 0)) + 10
        : 0;
      const newMetas = await base44.entities.LocalMovieMeta.bulkCreate(
        newEpisodes.map((ep, i) => ({
          name: ep.title || `第 ${existingMetas.length + i + 1} 集`,
          video_url: ep.video_url || '',
          poster_url: '',
          folder: folderId,
          sort_order: startOrder + i * 10,
          subtitles: [],
        }))
      );
      created = newMetas.length;

      // 为每个新建的 LocalMovieMeta 加载字幕
      for (let i = 0; i < newEpisodes.length; i++) {
        const subs = await base44.entities.Subtitle.filter({ episode_id: newEpisodes[i].id }, 'order', 500);
        if (subs && subs.length > 0) {
          const mapped = subs.map(s => ({
            text_en: s.text_en || '',
            text_zh: s.text_zh || '',
            time_start: s.time_start || '',
            time_end: s.time_end || '',
            timestamp: s.timestamp || '',
            order: s.order || 0,
          }));
          await base44.entities.LocalMovieMeta.update(newMetas[i].id, { subtitles: mapped });
        }
      }
    }

    // 同步已有 Episode 的字幕变化：如果发布者更新了字幕，订阅者也需要更新
    let updated = 0;
    for (const ep of episodes) {
      if (!ep.video_url) continue;
      const meta = metaByUrl.get(ep.video_url);
      if (!meta) continue;
      const subs = await base44.entities.Subtitle.filter({ episode_id: ep.id }, 'order', 500);
      const remoteCount = subs ? subs.length : 0;
      const localCount = (meta.subtitles || []).length;
      if (remoteCount === localCount && remoteCount === 0) continue;
      if (remoteCount === localCount) continue; // 数量一致则跳过（避免无谓写入）
      const mapped = (subs || []).map(s => ({
        text_en: s.text_en || '',
        text_zh: s.text_zh || '',
        time_start: s.time_start || '',
        time_end: s.time_end || '',
        timestamp: s.timestamp || '',
        order: s.order || 0,
      }));
      await base44.entities.LocalMovieMeta.update(meta.id, { subtitles: mapped });
      updated++;
    }

    return Response.json({
      ok: true,
      synced: created,
      updated,
      movie_id: folder.movie_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}