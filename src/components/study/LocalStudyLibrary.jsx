import React, { useState, useMemo } from "react";
import LocalMovieCard from "./LocalMovieCard";
import FolderBar from "./FolderBar";
import { Film, Plus, Trash2, Loader2, FolderInput, Check, X, SlidersHorizontal, Youtube, GripVertical, ArrowLeft, Pencil } from "lucide-react";
import { formatEpisodeCode, parseEpisodeNumber } from "@/lib/localSeason";
import LocalPosterPicker from "@/components/study/LocalPosterPicker";
import LocalPosterImage from "@/components/study/LocalPosterImage";

export default function LocalStudyLibrary({ metas, folders, loading, onOpen, onDelete, onDeleteMany, onDeleteSeason, onReorder, onReorderLocal, onMoveToFolder, onCreateFolder, onCreateAlbum, onUpdateAlbum, onRenameFolder, onSetFolderCover, onDeleteFolder, requireAuth, onImportLocal, onImportSeason, onOrganizeAsSeason, onAssignEpisode, onUpdateEpisodeNumber, onImportYoutube, onPublishFolder, onUnpublishFolder }) {
  const [tab, setTab] = useState("videos");
  const [activeFolder, setActiveFolder] = useState("all");
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showFolderPanel, setShowFolderPanel] = useState(false);
  const [panelFolderName, setPanelFolderName] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [publishingId, setPublishingId] = useState(null);
  const [activeSeasonId, setActiveSeasonId] = useState(null);
  const [organizeDialog, setOrganizeDialog] = useState(false);
  const [seasonDraft, setSeasonDraft] = useState({ showTitle: "", seasonNumber: "1", coverFile: null, coverUrl: "" });
  const [dropDialog, setDropDialog] = useState(null);
  const [albumDialog, setAlbumDialog] = useState(false);
  const [albumDraft, setAlbumDraft] = useState({ id: null, name: "", coverFile: null, coverUrl: "", coverChanged: false, coverItem: null });

  const handlePublish = async (folder) => {
    if (!onPublishFolder) return null;
    setPublishingId(folder.id);
    try {
      return await onPublishFolder(folder);
    } finally {
      setPublishingId(null);
    }
  };

  const landscape = tab === "videos";
  const onlineMetas = useMemo(() => metas.filter((m) => m.video_url), [metas]);
  const localMetas = useMemo(() => metas.filter((m) => !m.video_url), [metas]);
  const currentMetas = landscape ? onlineMetas : localMetas;

  const tabFolders = useMemo(
    () => folders.filter((f) => f.tab_type === tab).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [folders, tab]
  );
  const seasonProjects = useMemo(() => tabFolders.filter((folder) => folder.project_type === "season"), [tabFolders]);
  const seasonProjectIds = useMemo(() => new Set(seasonProjects.map((folder) => folder.id)), [seasonProjects]);
  const seasonEpisodes = useMemo(() => currentMetas.filter((meta) => seasonProjectIds.has(meta.folder)), [currentMetas, seasonProjectIds]);
  const looseMetas = useMemo(() => currentMetas.filter((meta) => !seasonProjectIds.has(meta.folder)), [currentMetas, seasonProjectIds]);
  const looseEpisodes = useMemo(() => looseMetas.filter((meta) => meta.media_type === "episode" || parseEpisodeNumber(meta.name || meta.original_title)), [looseMetas]);
  const movieMetas = useMemo(() => looseMetas.filter((meta) => !looseEpisodes.includes(meta)), [looseMetas, looseEpisodes]);
  const activeSeason = seasonProjects.find((folder) => folder.id === activeSeasonId) || null;
  const activeEpisodes = useMemo(() => activeSeason ? seasonEpisodes.filter((meta) => meta.folder === activeSeason.id).sort((a, b) => (a.sort_order ?? a.episode_number ?? 0) - (b.sort_order ?? b.episode_number ?? 0)) : [], [activeSeason, seasonEpisodes]);

  const folderCounts = useMemo(() => {
    const counts = { uncategorized: 0 };
    currentMetas.forEach((m) => {
      if (m.folder && tabFolders.find((f) => f.id === m.folder)) {
        counts[m.folder] = (counts[m.folder] || 0) + 1;
      } else {
        counts.uncategorized++;
      }
    });
    return counts;
  }, [currentMetas, tabFolders]);

  const filtered = useMemo(() => {
    let list = currentMetas;
    if (activeFolder === "uncategorized") {
      list = list.filter((m) => !m.folder || !tabFolders.find((f) => f.id === m.folder));
    } else if (activeFolder !== "all") {
      list = list.filter((m) => m.folder === activeFolder);
    }
    return [...list].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [currentMetas, activeFolder, tabFolders]);
  const displayCount = landscape ? filtered.length : activeSeason ? activeEpisodes.length : movieMetas.length + looseEpisodes.length + seasonProjects.length;
  const selectableKeys = landscape
    ? filtered.map((meta) => meta.id)
    : activeSeason
      ? activeEpisodes.map((meta) => meta.id)
      : [...looseMetas.map((meta) => meta.id), ...seasonProjects.map((folder) => `folder:${folder.id}`)];

  const switchTab = (t) => { setTab(t); setActiveFolder("all"); setManageMode(false); setSelectedIds(new Set()); setShowFolderPanel(false); setActiveSeasonId(null); };

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds(selectedIds.size === selectableKeys.length ? new Set() : new Set(selectableKeys));

  const handleDeleteSelected = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`确定从 LingoClub 移除选中的 ${selectedIds.size} 个项目？原始磁盘文件不会被删除。`)) return;
    const deleteCopiedMedia = window.confirm("是否同时清理 LingoClub 以前保存的视频副本？选择“取消”只移除条目和文件引用。");
    const folderIds = [...selectedIds].filter((id) => id.startsWith("folder:")).map((id) => id.slice("folder:".length));
    const movieIds = [...selectedIds].filter((id) => !id.startsWith("folder:"));
    for (const folderId of folderIds) {
      const episodes = seasonEpisodes.filter((episode) => episode.folder === folderId);
      await onDeleteSeason?.(folderId, episodes.map((episode) => episode.id), { deleteCopiedMedia });
    }
    if (movieIds.length) await onDeleteMany(movieIds, { deleteCopiedMedia });
    setSelectedIds(new Set());
    setManageMode(false);
  };

  const handleDeleteMovie = async (movie) => {
    const youtube = Boolean(movie?.video_url);
    const prompt = youtube
      ? `从 LingoClub 移除“${movie.name || "此条目"}”？不会删除 YouTube 视频。`
      : `从 LingoClub 移除“${movie?.name || "此影片"}”？磁盘中的原始文件不会删除。`;
    if (!window.confirm(prompt)) return;
    const deleteCopiedMedia = !youtube && window.confirm("是否同时清理 LingoClub 以前保存的视频副本？选择“取消”只删除条目和文件引用。");
    await onDelete(movie.id, { deleteCopiedMedia });
  };

  const handleDeleteSeason = async (season) => {
    const episodes = seasonEpisodes.filter((episode) => episode.folder === season.id);
    if (!window.confirm(`删除 Season Project“${season.display_title || season.name}”？其中包含 ${episodes.length} 集。原始磁盘文件不会删除。`)) return;
    const deleteCopiedMedia = window.confirm("是否同时清理 LingoClub 以前保存的视频副本？选择“取消”只移除项目和文件引用。");
    await onDeleteSeason?.(season.id, episodes.map((episode) => episode.id), { deleteCopiedMedia });
    setActiveSeasonId(null);
  };

  const setLocalDragPayload = (event, type, id, groupId = null) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.setData("application/x-lingoclub-local", JSON.stringify({ type, id, groupId }));
  };

  const localDropPayload = (event) => {
    try { return JSON.parse(event.dataTransfer.getData("application/x-lingoclub-local")); }
    catch { return { type: "movie", id: event.dataTransfer.getData("text/plain") }; }
  };

  const reorderLocalTarget = (event, type, targetId, groupId = null) => {
    event.preventDefault();
    if (!manageMode || !onReorderLocal) return;
    const dragged = localDropPayload(event);
    if (type === "season" && dragged.type !== "season") {
      const movie = currentMetas.find((item) => item.id === dragged.id);
      const season = seasonProjects.find((item) => item.id === targetId);
      if (movie && season) startSeasonDrop(event, season);
      return;
    }
    if (dragged.type !== type || dragged.groupId !== groupId || dragged.id === targetId) return;
    const source = type === "season" ? seasonProjects
      : type === "episode" ? activeEpisodes
        : type === "movie" ? movieMetas
          : looseEpisodes;
    const next = [...source];
    const from = next.findIndex((item) => item.id === dragged.id);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderLocal(type, next.map((item) => item.id));
  };

  // ===== HTML5 拖拽：卡片间排序 + 拖入文件夹 =====
  const onDragStart = (i) => (e) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", filtered[i].id);
  };
  const onDragOver = (i) => (e) => {
    if (!manageMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIndex !== i) setOverIndex(i);
  };
  const onDrop = (i) => (e) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (!manageMode || from === null || from === i) return;
    const reordered = [...filtered];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(i, 0, moved);
    onReorder(reordered.map((m) => m.id));
  };
  const onDragEnd = () => { setDragIndex(null); setOverIndex(null); };

  // ===== 拖到文件夹芯片 =====
  const handleDropToFolder = (folderId, itemId) => {
    onMoveToFolder([itemId], folderId);
  };

  // ===== 文件夹归入面板 =====
  const handleMoveSelectedToFolder = (folderId) => {
    if (!selectedIds.size) return;
    onMoveToFolder([...selectedIds], folderId);
    setSelectedIds(new Set());
    setShowFolderPanel(false);
  };
  const handleCreateAndMove = async () => {
    const name = panelFolderName.trim();
    if (!name || !selectedIds.size) return;
    const folder = await onCreateFolder(name, tab);
    if (folder?.id) onMoveToFolder([...selectedIds], folder.id);
    setSelectedIds(new Set());
    setShowFolderPanel(false);
    setPanelFolderName("");
  };

  const startSeasonDrop = (event, season) => {
    event.preventDefault();
    const movieId = localDropPayload(event).id;
    const movie = currentMetas.find((item) => item.id === movieId);
    if (!movie || !season || movie.folder === season.id) return;
    const detected = parseEpisodeNumber(movie.name || movie.original_title);
    setDropDialog({ movieId, seasonId: season.id, seasonTitle: season.display_title || season.name, episodeNumber: movie.episode_number || detected?.episodeNumber || 1 });
  };

  const confirmSeasonDrop = async () => {
    if (!dropDialog) return;
    const number = Number(dropDialog.episodeNumber);
    if (!Number.isInteger(number) || number < 1 || number > 999) return;
    await onAssignEpisode?.(dropDialog.movieId, dropDialog.seasonId, number);
    setDropDialog(null);
  };

  const organizeSelectionAsSeason = async () => {
    const showTitle = seasonDraft.showTitle.trim();
    const number = Number(seasonDraft.seasonNumber);
    if (!showTitle || !Number.isInteger(number) || number < 1 || number > 99 || !selectedIds.size) return;
    await onOrganizeAsSeason?.([...selectedIds], { showTitle, seasonNumber: number, coverFile: seasonDraft.coverFile });
    setOrganizeDialog(false);
    setSeasonDraft({ showTitle: "", seasonNumber: "1", coverFile: null, coverUrl: "" });
    setSelectedIds(new Set());
    setManageMode(false);
  };

  const saveAlbum = async () => {
    const name = albumDraft.name.trim();
    if (!name) return;
    if (albumDraft.id) {
      await onUpdateAlbum?.(albumDraft.id, { name, coverFile: albumDraft.coverFile, coverUrl: albumDraft.coverUrl, coverChanged: albumDraft.coverChanged });
    } else {
      await onCreateAlbum?.({ name, coverFile: albumDraft.coverFile, coverUrl: albumDraft.coverUrl });
    }
    setAlbumDialog(false);
    setAlbumDraft({ id: null, name: "", coverFile: null, coverUrl: "", coverChanged: false, coverItem: null });
  };

  const seasonCard = (season, compact = false) => {
    const episodes = seasonEpisodes.filter((episode) => episode.folder === season.id);
    const learned = episodes.filter((episode) => Boolean(episode.last_studied_at || Number(episode.learning_progress || 0) > 0)).length;
    return (
      <div
        key={season.id}
        draggable={manageMode && !compact}
        onDragStart={(event) => manageMode && setLocalDragPayload(event, "season", season.id)}
        onDragOver={(event) => { if (manageMode) event.preventDefault(); }}
        onDrop={(event) => manageMode && reorderLocalTarget(event, "season", season.id)}
        className={`group relative overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-colors hover:border-copper/40 ${compact ? "w-40 shrink-0" : ""}`}
      >
        <button type="button" onClick={() => { setManageMode(false); setSelectedIds(new Set()); setActiveSeasonId(season.id); }} className="block w-full text-left">
          <div className={`${compact ? "aspect-[3/2]" : "aspect-[2/3]"} overflow-hidden bg-muted/30`}>
            <LocalPosterImage item={season} kind="folder" alt={season.display_title || season.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" placeholder={<div className="flex h-full items-center justify-center text-muted-foreground/40"><Film size={28} /></div>} />
          </div>
          <div className="px-2.5 py-2">
            <p className="line-clamp-2 font-display text-xs text-foreground">{season.display_title || season.name}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">{episodes.length} 集 · 已学习 {learned} / {episodes.length}</p>
          </div>
        </button>
        {manageMode && !compact && (
          <>
            <input type="checkbox" checked={selectedIds.has(`folder:${season.id}`)} onChange={() => toggleSelect(`folder:${season.id}`)} aria-label={`选择影集${season.display_title || season.name}`} className="absolute left-2 top-2 z-10 h-4 w-4 accent-copper" />
          <button type="button" onClick={(event) => { event.stopPropagation(); setAlbumDraft({ id: season.id, name: season.display_title || season.name, coverFile: null, coverUrl: season.cover_url || "", coverChanged: false, coverItem: season }); setAlbumDialog(true); }} title="编辑影集" className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 p-1.5 text-white/80 hover:text-white"><Pencil size={13} /></button>
          </>
        )}
        {manageMode && !compact && (
          <button type="button" onClick={(event) => { event.stopPropagation(); handleDeleteSeason(season); }} title="删除本季及其 Episodes" aria-label={`删除${season.display_title || season.name}`} className="absolute bottom-2 right-2 rounded-full bg-rose-950/80 p-2 text-rose-100 hover:bg-rose-700">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  const chip = (active) => `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground hover:border-copper/50"}`;

  const gridClass = landscape
    ? "mt-6 grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
    : "mt-6 grid grid-cols-2 gap-2.5 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 lg:px-10 pt-20 pb-16 md:pt-28 md:pb-20">
      <p className="text-[11px] uppercase tracking-luxe text-copper/80">工具箱 · 我的影片</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <h1 className="font-display text-2xl leading-tight text-foreground md:text-4xl">{landscape ? "我的视频" : activeSeason ? (activeSeason.display_title || activeSeason.name) : "我的影片"}</h1>
        <div className="flex items-center gap-2">
          {tab === "films" ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { if (requireAuth()) onImportLocal(); }} className="inline-flex items-center gap-1.5 rounded-full border border-copper/40 px-3.5 py-2 text-sm font-medium text-copper transition-colors hover:bg-copper/10">
                <Plus size={15} /> 导入电影
              </button>
              <button type="button" onClick={() => { if (requireAuth()) onImportSeason?.(); }} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
                <Plus size={16} /> 导入剧集
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { if (requireAuth()) onImportYoutube(); }} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02]">
              <Youtube size={16} /> 导入 YouTube 视频
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 max-w-2xl text-[11px] leading-snug text-muted-foreground md:mt-2 md:text-xs">
        {landscape
          ? "点击「导入 YouTube 视频」粘贴链接即可导入，标题/封面/字幕自动获取，存云端任意设备可播放。拖拽视频到文件夹芯片即可分类，右键文件夹可发布为共享小组。"
          : "本地影片保存在当前设备。整理模式可创建影集、选择删除项目，并拖动调整顺序或将影片归入影集。"}
      </p>

      {/* Tab switcher */}
      <div className="mt-3 flex gap-1.5 md:mt-5">
        <button type="button" onClick={() => switchTab("videos")} className={chip(tab === "videos")}>
          我的视频 <span className="opacity-70">{onlineMetas.length}</span>
        </button>
        <button type="button" onClick={() => switchTab("films")} className={chip(tab === "films")}>
          我的影片 <span className="opacity-70">{localMetas.length}</span>
        </button>
      </div>

      {/* Existing YouTube organization remains unchanged; Local uses direct Season Projects. */}
      {landscape && <div className="mt-4">
        <FolderBar
          folders={tabFolders}
          activeFolder={activeFolder}
          counts={folderCounts}
          onSelect={setActiveFolder}
          onCreate={(name) => onCreateFolder(name, tab)}
          onRename={onRenameFolder}
          onSetCover={onSetFolderCover}
          onDelete={onDeleteFolder}
          onDropToFolder={handleDropToFolder}
          canManage={manageMode}
          onPublish={handlePublish}
          publishingId={publishingId}
          onUnpublish={onUnpublishFolder}
        />
      </div>}

      {/* Manage toolbar */}
      <div className="mt-3 flex items-center justify-between gap-2 md:mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setManageMode((v) => !v); setSelectedIds(new Set()); setShowFolderPanel(false); }} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${manageMode ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground hover:border-copper/50"}`}>
            <SlidersHorizontal size={12} /> {manageMode ? "完成整理" : "整理"}
          </button>
          {manageMode && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <GripVertical size={12} /> {landscape ? "拖动卡片排序或拖到文件夹" : "拖动排序或将影片拖入影集"}
            </span>
          )}
          {manageMode && tab === "films" && !activeSeason && (
            <button type="button" onClick={() => { setAlbumDraft({ id: null, name: "", coverFile: null, coverUrl: "", coverChanged: false, coverItem: null }); setAlbumDialog(true); }} className="inline-flex items-center gap-1.5 rounded-full border border-copper/30 bg-copper/5 px-3 py-1.5 text-xs font-medium text-copper hover:bg-copper/10"><Plus size={12} /> 创建影集</button>
          )}
          {manageMode && selectableKeys.length > 0 && (
            <>
              <button type="button" onClick={toggleAll} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                <Check size={11} /> {selectedIds.size === selectableKeys.length ? "取消全选" : "全选"}
              </button>
              {selectedIds.size > 0 && (
                <>
                  <button type="button" onClick={handleDeleteSelected} className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 px-3 py-1.5 text-xs font-medium text-rose-300/80 transition-colors hover:text-rose-300 hover:border-rose-500/50">
                    <Trash2 size={11} /> 删除选中({selectedIds.size})
                  </button>
                  {landscape ? (
                    <button type="button" onClick={() => setShowFolderPanel((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${showFolderPanel ? "bg-copper text-copper-foreground" : "border border-copper/30 bg-copper/5 text-copper hover:bg-copper/10"}`}>
                      <FolderInput size={12} /> 归入文件夹
                    </button>
                  ) : !activeSeason ? (
                    <button type="button" onClick={() => setOrganizeDialog(true)} className="inline-flex items-center gap-1.5 rounded-full border border-copper/30 bg-copper/5 px-3 py-1.5 text-xs font-medium text-copper hover:bg-copper/10">
                      <FolderInput size={12} /> 整理为一季
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{displayCount} 个</span>
      </div>

      {/* Folder panel */}
      {landscape && showFolderPanel && selectedIds.size > 0 && (
        <div className="mt-3 rounded-xl border border-copper/30 bg-copper/5 p-4">
          <p className="text-xs font-medium text-foreground/90">将选中的 {selectedIds.size} 个{landscape ? "视频" : "影片"}归入文件夹</p>
          {tabFolders.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tabFolders.map((f) => (
                <button key={f.id} type="button" onClick={() => handleMoveSelectedToFolder(f.id)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elev/50 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-copper/50 hover:bg-copper/10">
                  {f.name} <span className="opacity-50">{folderCounts[f.id] || 0}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={panelFolderName}
              onChange={(e) => setPanelFolderName(e.target.value)}
              placeholder={tabFolders.length > 0 ? "或输入新文件夹名…" : "输入新文件夹名…"}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndMove(); }}
              className="min-w-[200px] flex-1 rounded-lg border border-border bg-background-elev/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
              autoFocus
            />
            <button type="button" onClick={handleCreateAndMove} disabled={!panelFolderName.trim()} className="inline-flex items-center gap-1.5 rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-40">
              <Check size={13} /> 创建并归入
            </button>
            <button type="button" onClick={() => setShowFolderPanel(false)} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
              <X size={13} /> 取消
            </button>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> 读取中…
        </div>
      ) : landscape && filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-background-elev/30 p-14 text-center">
          <Film size={28} className="mx-auto text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">
            {activeFolder !== "all" ? "此文件夹中没有内容。" : "还没有在线视频，用书签工具从 YouTube / B站导入。"}
          </p>
        </div>
      ) : landscape ? (
        <div className={gridClass}>
          {filtered.map((m, i) => (
            <div
              key={m.id}
              draggable
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              className={`transition-opacity ${dragIndex === i ? "opacity-40" : ""} ${manageMode && overIndex === i && dragIndex !== null && dragIndex !== i ? "ring-2 ring-copper rounded-xl" : ""} ${dragIndex !== null ? "cursor-grabbing" : "cursor-grab"}`}
            >
              <LocalMovieCard meta={m} manageMode={manageMode} selected={selectedIds.has(m.id)} onToggleSelect={toggleSelect} onOpen={onOpen} onDelete={() => handleDeleteMovie(m)} landscape={landscape} />
            </div>
          ))}
        </div>
      ) : activeSeason ? (
        <section className="mt-5">
          <button type="button" onClick={() => setActiveSeasonId(null)} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-copper"><ArrowLeft size={15} /> 我的影片</button>
          <h2 className="font-display text-xl text-foreground">{activeSeason.display_title || activeSeason.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{activeEpisodes.length} 集</p>
          {seasonProjects.length > 1 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2" aria-label="拖动到另一季以移动剧集">
              {seasonProjects.filter((season) => season.id !== activeSeason.id).map((season) => (
                <button key={season.id} type="button" onDragOver={(event) => manageMode && event.preventDefault()} onDrop={(event) => manageMode && startSeasonDrop(event, season)} onClick={() => { setManageMode(false); setSelectedIds(new Set()); setActiveSeasonId(season.id); }} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-copper/50 hover:text-copper">
                  拖到此处：{season.display_title || season.name}
                </button>
              ))}
            </div>
          )}
          {activeEpisodes.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">这一季还没有 Episodes。</div>
          ) : (
            <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
              {activeEpisodes.map((episode) => {
                const episodeNumber = Number(episode.episode_number) || parseEpisodeNumber(episode.name)?.episodeNumber || 1;
                const episodeCode = formatEpisodeCode(activeSeason.season_number, episodeNumber);
                return (
                  <div key={episode.id} draggable={manageMode} onDragStart={(event) => manageMode && setLocalDragPayload(event, "episode", episode.id, activeSeason.id)} onDragOver={(event) => manageMode && event.preventDefault()} onDrop={(event) => reorderLocalTarget(event, "episode", episode.id, activeSeason.id)} className={`flex items-center gap-3 px-3 py-3 md:px-4 ${manageMode ? "cursor-grab" : ""}`}>
                    {manageMode && <input type="checkbox" checked={selectedIds.has(episode.id)} onChange={() => toggleSelect(episode.id)} aria-label={`选择${episode.episode_title || episode.name}`} />}
                    <span className="cursor-grab text-muted-foreground/50" aria-hidden="true"><GripVertical size={15} /></span>
                    <input type="number" min="1" max="999" defaultValue={episodeNumber} aria-label={`${episodeCode} 集数`} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const next = Number(event.currentTarget.value); if (Number.isInteger(next) && next > 0 && next !== episodeNumber) onUpdateEpisodeNumber?.(episode.id, next); }} className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground" />
                    <button type="button" onClick={() => onOpen(episode, true)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium text-foreground">{episode.title || episode.episode_title || episodeCode}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{episode.subtitles?.length ? `${episode.subtitles.length} 条字幕` : "暂无字幕"}{episode.last_studied_at ? " · 已学习" : ""}</span>
                    </button>
                    {!manageMode && <button type="button" onClick={() => handleDeleteMovie(episode)} aria-label={`删除${episode.episode_title || episode.name}`} title="从影片库移除此集" className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={14} /></button>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <div className="mt-5 space-y-7">
          {seasonProjects.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">剧集季</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {seasonProjects.map((season) => seasonCard(season))}
              </div>
            </section>
          )}
          {movieMetas.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">电影</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {movieMetas.map((movie) => (
                  <div key={movie.id} draggable={manageMode} onDragStart={(event) => manageMode && setLocalDragPayload(event, "movie", movie.id)} onDragOver={(event) => manageMode && event.preventDefault()} onDrop={(event) => reorderLocalTarget(event, "movie", movie.id)} className={manageMode ? "cursor-grab" : ""}>
                    <LocalMovieCard meta={movie} manageMode={manageMode} selected={selectedIds.has(movie.id)} onToggleSelect={toggleSelect} onOpen={(meta) => onOpen(meta, true)} onDelete={() => handleDeleteMovie(movie)} landscape={false} />
                    <p className="mt-1 text-center text-[10px] text-muted-foreground">{movie.last_studied_at ? "已学习" : "未学习"}{movie.subtitles?.length ? ` · ${movie.subtitles.length} 条字幕` : ""}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
          {looseEpisodes.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">未整理</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {looseEpisodes.map((episode) => (
                  <div key={episode.id} draggable={manageMode} onDragStart={(event) => manageMode && setLocalDragPayload(event, "looseEpisode", episode.id)} onDragOver={(event) => manageMode && event.preventDefault()} onDrop={(event) => reorderLocalTarget(event, "looseEpisode", episode.id)} className={manageMode ? "cursor-grab" : ""}>
                    <LocalMovieCard meta={episode} manageMode={manageMode} selected={selectedIds.has(episode.id)} onToggleSelect={toggleSelect} onOpen={(meta) => onOpen(meta, true)} onDelete={() => handleDeleteMovie(episode)} landscape={false} />
                  </div>
                ))}
              </div>
            </section>
          )}
          {!seasonProjects.length && !movieMetas.length && !looseEpisodes.length && (
            <div className="rounded-2xl border border-dashed border-border bg-background-elev/30 p-14 text-center">
              <Film size={28} className="mx-auto text-muted-foreground/60" />
              <p className="mt-3 text-sm text-muted-foreground">还没有本地电影或剧集，选择「导入电影」或「导入剧集」开始。</p>
            </div>
          )}
        </div>
      )}

      {albumDialog && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h2 className="font-display text-lg text-foreground">{albumDraft.id ? "编辑影集" : "创建影集"}</h2>
            <label className="mt-4 block text-xs text-muted-foreground">名称
              <input value={albumDraft.name} onChange={(event) => setAlbumDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="输入影集名称" className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" autoFocus />
            </label>
            {albumDraft.coverItem && !albumDraft.coverChanged && <div className="relative mt-3 h-24 w-16 overflow-hidden rounded-lg"><LocalPosterImage item={albumDraft.coverItem} kind="folder" alt="当前影集封面" className="h-full w-full object-cover" placeholder={<div className="flex h-full items-center justify-center bg-muted text-muted-foreground"><Film size={18} /></div>} /></div>}
            <div className="mt-3"><LocalPosterPicker title={albumDraft.name} type="tv" selectedUrl={albumDraft.coverUrl} onSelect={({ file, url }) => setAlbumDraft((draft) => ({ ...draft, coverFile: file, coverUrl: url, coverChanged: true, coverItem: null }))} /></div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAlbumDialog(false)} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground">取消</button>
              <button type="button" onClick={saveAlbum} disabled={!albumDraft.name.trim()} className="rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground disabled:opacity-50">{albumDraft.id ? "保存" : "创建"}</button>
            </div>
          </div>
        </div>
      )}

      {organizeDialog && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h2 className="font-display text-lg text-foreground">整理为一季</h2>
            <p className="mt-1 text-xs text-muted-foreground">选中的影片将直接成为该 Season Project 下的 Episodes，字幕和学习数据会保留。</p>
            <input value={seasonDraft.showTitle} onChange={(event) => setSeasonDraft((state) => ({ ...state, showTitle: event.target.value }))} placeholder="剧名，例如 Hacks" className="mt-4 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
            <label className="mt-3 block text-xs text-muted-foreground">Season Number
              <input type="number" min="1" max="99" value={seasonDraft.seasonNumber} onChange={(event) => setSeasonDraft((state) => ({ ...state, seasonNumber: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
            </label>
            <div className="mt-3"><LocalPosterPicker title={seasonDraft.showTitle} type="tv" seasonNumber={seasonDraft.seasonNumber} selectedUrl={seasonDraft.coverUrl} onSelect={({ file, url }) => setSeasonDraft((state) => ({ ...state, coverFile: file, coverUrl: url }))} /></div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOrganizeDialog(false)} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground">取消</button>
              <button type="button" onClick={organizeSelectionAsSeason} disabled={!seasonDraft.showTitle.trim()} className="rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground disabled:opacity-50">确认整理</button>
            </div>
          </div>
        </div>
      )}

      {dropDialog && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h2 className="font-display text-lg text-foreground">加入 {dropDialog.seasonTitle}？</h2>
            <p className="mt-1 text-xs text-muted-foreground">只移动整理信息，不会删除或重建影片、字幕或学习数据。</p>
            <label className="mt-4 block text-xs text-muted-foreground">Episode Number
              <input type="number" min="1" max="999" value={dropDialog.episodeNumber} onChange={(event) => setDropDialog((state) => ({ ...state, episodeNumber: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDropDialog(null)} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground">取消</button>
              <button type="button" onClick={confirmSeasonDrop} className="rounded-full bg-copper px-4 py-2 text-xs font-medium text-copper-foreground">加入本季</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
