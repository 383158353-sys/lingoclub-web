import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// 发布文件夹为共享视频单：
// 1. 创建 Movie 实体（visibility=public），以文件夹名作为视频单名
// 2. 为文件夹中的每个 LocalMovieMeta 创建 Episode（含 video_url + subtitles）
// 3. 更新 StudyFolder：is_shared=true, movie_id, share_link, shared_date
//
// 健壮性：如果 Movie 已被删除但文件夹仍指向旧 movie_id，则重新创建全部数据。
// 如果 Movie 仍存在但缺少 Episode，则补全缺失的 Episode + Subtitle。
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const folderId = body.folder_id;
    if (!folderId) return Response.json({ error: '缺少 folder_id' }, { status: 400 });

    // 读取文件夹
    const folder = await base44.entities.StudyFolder.get(folderId);
    if (!folder) return Response.json({ error: '文件夹不存在' }, { status: 404 });

    // 读取文件夹中的所有视频
    const metas = await base44.entities.LocalMovieMeta.filter({ folder: folderId });
    if (!metas || metas.length === 0) {
      return Response.json({ error: '文件夹中没有视频，无法发布' }, { status: 400 });
    }

    // 用户在发布页编辑的字段
    const title = body.title?.trim() || folder.name;
    const description = body.description?.trim() || `由 ${user.full_name || '用户'} 整理的视频合集`;
    const poster_url = body.poster_url || folder.cover_url || '';
    const backdrop_url = body.backdrop_url || '';
    const difficulty = body.difficulty || 'intermediate';
    const price_credits = Number(body.price_credits) || 0;
    const tagline = body.tagline || '';

    // 检查 Movie 是否仍然存在（可能被删除或已下架导致文件夹指向无效 ID）
    // 即使 is_shared=false（下架后），只要 movie_id 仍在就复用，避免产生孤儿 Movie
    let movie = null;
    if (folder.movie_id) {
      try {
        movie = await base44.entities.Movie.get(folder.movie_id);
      } catch { movie = null; }
    }

    if (movie) {
      // Movie 仍存在：更新元数据并重新设为公开（下架时被改为 private，重新发布会恢复公开）
      await base44.entities.Movie.update(movie.id, {
        title, tagline, description, poster_url, backdrop_url, difficulty, price_credits,
        total_episodes: metas.length,
        visibility: 'public',
      });

      // 补全缺失的 Episode（按 video_url 去重）
      const existingEps = await base44.entities.Episode.filter({ movie_id: movie.id }, "order", 200);
      const existingVideoUrls = new Set(existingEps.filter(e => e.video_url).map(e => e.video_url));
      const newMetas = metas.filter(m => m.video_url && !existingVideoUrls.has(m.video_url));

      if (newMetas.length > 0) {
        const startOrder = (existingEps.at(-1)?.order || 0) + 10;
        const baseNum = existingEps.length;
        const newEps = await base44.entities.Episode.bulkCreate(
          newMetas.map((m, i) => ({
            movie_id: movie.id,
            title: m.name || `第 ${baseNum + i + 1} 集`,
            video_url: m.video_url || '',
            episode_number: baseNum + i + 1,
            order: startOrder + i * 10,
            contribution_status: 'approved',
          }))
        );
        for (let i = 0; i < newEps.length; i++) {
          const ep = newEps[i];
          const subs = newMetas[i].subtitles || [];
          if (subs.length === 0) continue;
          await base44.entities.Subtitle.bulkCreate(
            subs.map((s, j) => ({
              movie_id: movie.id,
              episode_id: ep.id,
              text_en: s.text_en || '',
              text_zh: s.text_zh || '',
              time_start: s.time_start || '',
              time_end: s.time_end || '',
              timestamp: s.time_start || '',
              order: j,
              analysis_status: 'none',
            }))
          );
        }
      }

      // 同步已有 Episode 的字幕：发布者可能在本地修改了已有视频的字幕
      for (const ep of existingEps) {
        const matchedMeta = metas.find(m => m.video_url && m.video_url === ep.video_url);
        if (!matchedMeta) continue;
        const localSubs = matchedMeta.subtitles || [];
        // 读取 Episode 现有字幕数量，仅在数量不一致时更新（避免无谓写入）
        const existingSubs = await base44.entities.Subtitle.filter({ episode_id: ep.id }, null, 500);
        if (existingSubs.length === localSubs.length) continue;
        // 删除旧字幕，重建
        if (existingSubs.length > 0) {
          await base44.entities.Subtitle.deleteMany({ episode_id: ep.id });
        }
        if (localSubs.length > 0) {
          await base44.entities.Subtitle.bulkCreate(
            localSubs.map((s, j) => ({
              movie_id: movie.id,
              episode_id: ep.id,
              text_en: s.text_en || '',
              text_zh: s.text_zh || '',
              time_start: s.time_start || '',
              time_end: s.time_end || '',
              timestamp: s.time_start || '',
              order: j,
              analysis_status: 'none',
            }))
          );
        }
      }

      return Response.json({
        ok: true,
        movie_id: movie.id,
        share_link: folder.share_link || `/movie/${movie.id}`,
        already_published: true,
        episode_count: metas.length,
      });
    }

    // Movie 不存在（或从未发布过）：创建新的 Movie + Episodes + Subtitles
    const newMovie = await base44.entities.Movie.create({
      title,
      tagline,
      description,
      poster_url,
      backdrop_url,
      visibility: 'public',
      creator_name: user.full_name || '',
      genre: ['视频合集'],
      language: 'en',
      total_episodes: metas.length,
      member_count: 1,
      is_featured: false,
      difficulty,
      price_credits,
    });

    const episodes = await base44.entities.Episode.bulkCreate(
      metas.map((m, i) => ({
        movie_id: newMovie.id,
        title: m.name || `第 ${i + 1} 集`,
        video_url: m.video_url || '',
        episode_number: i + 1,
        order: i * 10,
        contribution_status: 'approved',
      }))
    );

    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      const subs = metas[i].subtitles || [];
      if (subs.length === 0) continue;
      await base44.entities.Subtitle.bulkCreate(
        subs.map((s, j) => ({
          movie_id: newMovie.id,
          episode_id: ep.id,
          text_en: s.text_en || '',
          text_zh: s.text_zh || '',
          time_start: s.time_start || '',
          time_end: s.time_end || '',
          timestamp: s.time_start || '',
          order: j,
          analysis_status: 'none',
        }))
      );
    }

    const shareLink = `/movie/${newMovie.id}`;
    // 重新发布（下架后）：恢复 is_shared / share_link / shared_date，movie_id 不变
    await base44.entities.StudyFolder.update(folderId, {
      is_shared: true,
      movie_id: newMovie.id,
      share_link: shareLink,
      shared_date: new Date().toISOString(),
    });

    return Response.json({
      ok: true,
      movie_id: newMovie.id,
      share_link: shareLink,
      episode_count: episodes.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}