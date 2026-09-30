import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import SubtitleWorkbench from "./SubtitleWorkbench";

// 剧集台词管理：将 SubtitleWorkbench（统一字幕工作台）与 Subtitle 实体对接。
// 加载剧集的所有台词到本地数组 → 传给 SubtitleWorkbench 管理 →
// onChanged 时 diff 出增删改 → 持久化到 Subtitle 实体 → 回调 onSubsChanged 触发刷新。
// 先乐观更新本地状态（即时反馈），再后台持久化。
export default function EpisodeSubtitleManager({
  episode,
  movieId,
  movieTitle,
  videoRef,
  canPlay,
  onSeek,
  reloadKey = 0,
  onSubsChanged,
}) {
  const { toast } = useToast();
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadSubs = useCallback(async () => {
    if (!episode?.id) return;
    setLoading(true);
    try {
      const list = await base44.entities.Subtitle.filter({ episode_id: episode.id }, "order", 500);
      const mapped = (list || []).map((s) => ({
        id: s.id,
        text_en: s.text_en || "",
        text_zh: s.text_zh || "",
        speaker: s.speaker || "",
        time_start: s.time_start || "",
        time_end: s.time_end || "",
        order: s.order ?? 0,
        timestamp: s.timestamp || s.time_start || "",
        _persisted: true,
      }));
      setSubs(mapped);
    } catch {
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, [episode?.id]);

  useEffect(() => { loadSubs(); }, [loadSubs, reloadKey]);

  const onChanged = useCallback(async (newSubs) => {
    const oldMap = new Map(subs.map((s) => [s.id, s]));

    // 乐观更新：先更新本地状态，即时反馈
    setSubs(newSubs);

    const newMap = new Map(newSubs.map((s) => [s.id, s]));

    // 删除被移除的台词
    for (const [id, s] of oldMap) {
      if (!newMap.has(id) && s._persisted) {
        try { await base44.entities.Subtitle.delete(id); } catch { /* noop */ }
      }
    }

    // 创建新台词 + 更新已有台词
    const createdItems = [];
    for (const s of newSubs) {
      const old = oldMap.get(s.id);
      if (!old || !s._persisted) {
        // 新台词（本地 ID，以 "local-" 开头）→ 创建实体
        try {
          const created = await base44.entities.Subtitle.create({
            episode_id: episode.id,
            movie_id: movieId,
            text_en: s.text_en,
            text_zh: s.text_zh || "",
            speaker: s.speaker || "",
            time_start: s.time_start || "",
            time_end: s.time_end || "",
            order: s.order ?? 0,
            timestamp: s.timestamp || s.time_start || "",
          });
          createdItems.push({ localId: s.id, entityId: created.id });
        } catch (e) {
          console.warn("Create subtitle failed", e);
        }
      } else if (
        old.text_en !== s.text_en ||
        old.text_zh !== s.text_zh ||
        old.time_start !== s.time_start ||
        old.time_end !== s.time_end ||
        old.speaker !== s.speaker
      ) {
        // 已有但内容变化 → 更新
        try {
          await base44.entities.Subtitle.update(s.id, {
            text_en: s.text_en,
            text_zh: s.text_zh || "",
            speaker: s.speaker || "",
            time_start: s.time_start || "",
            time_end: s.time_end || "",
            order: s.order ?? 0,
            timestamp: s.timestamp || s.time_start || "",
          });
        } catch (e) {
          console.warn("Update subtitle failed", e);
        }
      }
    }

    // 用真实实体 ID 替换本地临时 ID
    if (createdItems.length > 0) {
      setSubs((prev) => prev.map((s) => {
        const found = createdItems.find((c) => c.localId === s.id);
        return found ? { ...s, id: found.entityId, _persisted: true } : s;
      }));
    }

    // 通知父组件刷新 study（useEpisodeStudy 重新加载）
    onSubsChanged?.();
  }, [subs, episode?.id, movieId, onSubsChanged]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        加载台词…
      </div>
    );
  }

  return (
    <SubtitleWorkbench
      videoRef={videoRef}
      videoUrl={episode?.video_url || ""}
      subs={subs}
      onChanged={onChanged}
      onSeek={onSeek}
      canPlay={canPlay}
    />
  );
}