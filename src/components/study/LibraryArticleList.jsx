import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { listDailyArticles, setArticleFavorite, setArticleFolder } from "@/lib/dailyArticles";
import { getLibraryArticle, listDeletedLibraryArticles, listLibraryArticles, restoreLibraryArticles, setLibraryArticleFavorite, setLibraryArticleFolder, softDeleteLibraryArticles } from "@/lib/libraryArticles";
import { articleDomain } from "@/lib/dailyArticlesFormat";
import { mergeStudyArticles } from "@/lib/articleLibrary";
import { FAVORITES_FOLDER, itemsInLibraryFolder, libraryFolderCounts, nextFavorited } from "@/lib/libraryFilters";
import { localFolders } from "@/lib/localStudyMeta";
import FolderBar from "@/components/study/FolderBar";
import ArticleLinkImporter from "@/components/study/ArticleLinkImporter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const ARTICLE_TAB = "articles";

export default function LibraryArticleList({ onImport, editId, onCloseEditor }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [bin, setBin] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(new Set());
  const [activeFolder, setActiveFolder] = useState("all");
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showBin, setShowBin] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const loadFolders = useCallback(async () => {
    const all = await localFolders.list().catch(() => []);
    setFolders(all.filter((folder) => folder.tab_type === ARTICLE_TAB && folder.project_type !== "season"));
  }, []);

  useEffect(() => {
    let active = true;
    setRows([]);
    setLoading(true);
    setError("");
    if (!user) { setLoading(false); return undefined; }
    Promise.all([
      listLibraryArticles().catch((loadError) => loadError),
      listDailyArticles().catch((loadError) => loadError),
      listDeletedLibraryArticles().catch(() => []),
    ]).then(([libraryResult, dailyResult, deletedResult]) => {
      if (!active) return;
      const libraryOk = Array.isArray(libraryResult);
      const dailyOk = Array.isArray(dailyResult);
      const libraryRows = libraryOk ? libraryResult : [];
      const dailyRows = dailyOk ? dailyResult : [];
      if ((!libraryOk && !dailyRows.length) || (!dailyOk && !libraryRows.length)) {
        setError(libraryResult?.message || dailyResult?.message || "文章加载失败");
        setRows([]);
        return;
      }
      setRows(mergeStudyArticles(libraryRows, dailyRows));
      setBin(Array.isArray(deletedResult) ? deletedResult : []);
    }).finally(() => { if (active) setLoading(false); });
    loadFolders();
    return () => { active = false; };
  }, [user?.id, refresh, loadFolders]);

  useEffect(() => {
    if (!editId) { setEditing(null); return undefined; }
    let active = true;
    setLoadingEdit(true);
    getLibraryArticle(editId, { includeDeleted: false }).then((row) => {
      if (!active) return;
      if (!row) { toast({ title: "无法编辑这篇", description: "只能编辑自己导入且未删除的文章", variant: "destructive" }); onCloseEditor?.(); return; }
      setEditing(row);
    }).catch(() => { if (active) { toast({ title: "文章加载失败", variant: "destructive" }); onCloseEditor?.(); } })
      .finally(() => { if (active) setLoadingEdit(false); });
    return () => { active = false; };
  }, [editId, toast, onCloseEditor]);

  const counts = useMemo(() => libraryFolderCounts(rows, folders), [rows, folders]);
  const visible = useMemo(() => itemsInLibraryFolder(rows, activeFolder, folders), [rows, activeFolder, folders]);

  const patch = (key, fields) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...fields } : row)));

  const favorite = async (item) => {
    const next = nextFavorited(item);
    setPending((ids) => new Set([...ids, item.key]));
    patch(item.key, { favorited: next });
    try {
      if (item.origin === "library") await setLibraryArticleFavorite(item.id, next);
      else await setArticleFavorite(item.id, next);
    } catch {
      patch(item.key, { favorited: !next });
      toast({ title: "收藏失败", description: "请稍后重试", variant: "destructive" });
    } finally {
      setPending((ids) => { const copy = new Set(ids); copy.delete(item.key); return copy; });
    }
  };

  const moveToFolder = async (token, folderId) => {
    const item = rows.find((row) => row.key === token);
    if (!item || folderId === FAVORITES_FOLDER) return;
    const previous = item.folder;
    patch(item.key, { folder: folderId || "" });
    try {
      if (item.origin === "library") await setLibraryArticleFolder(item.id, folderId);
      else await setArticleFolder(item.id, folderId);
    } catch {
      patch(item.key, { folder: previous });
      toast({ title: "移动失败", description: "请稍后重试", variant: "destructive" });
    }
  };

  const createFolder = async (name) => {
    try {
      await localFolders.create({ name, tab_type: ARTICLE_TAB, sort_order: Date.now() });
      await loadFolders();
    } catch (createError) {
      toast({ title: "创建文件夹失败", description: createError?.message, variant: "destructive" });
    }
  };

  const renameFolder = async (folderId, name) => {
    try {
      await localFolders.update(folderId, { name });
      await loadFolders();
    } catch (renameError) {
      toast({ title: "重命名失败", description: renameError?.message, variant: "destructive" });
    }
  };

  const setCover = async (folderId, file) => {
    try {
      await localFolders.update(folderId, { cover_blob: file });
      await loadFolders();
    } catch (coverError) {
      toast({ title: "设置封面失败", description: coverError?.message, variant: "destructive" });
    }
  };

  const deleteFolder = async (folderId) => {
    const affected = rows.filter((row) => row.folder === folderId);
    try {
      await Promise.all(affected.map((row) => (row.origin === "library" ? setLibraryArticleFolder(row.id, "") : setArticleFolder(row.id, ""))));
      setRows((current) => current.map((row) => (row.folder === folderId ? { ...row, folder: "" } : row)));
      await localFolders.delete(folderId);
      if (activeFolder === folderId) setActiveFolder("all");
      await loadFolders();
    } catch (deleteError) {
      toast({ title: "删除文件夹失败", description: deleteError?.message, variant: "destructive" });
    }
  };

  const undoDelete = async (ids) => {
    try {
      await restoreLibraryArticles(ids);
      setRefresh((n) => n + 1);
    } catch { toast({ title: "撤销失败", variant: "destructive" }); }
  };

  const removeLibrary = async (ids) => {
    const list = ids.filter(Boolean);
    if (!list.length) return;
    try {
      const removed = await softDeleteLibraryArticles(list);
      setRows((current) => current.filter((row) => !(row.origin === "library" && removed.includes(row.id))));
      setSelected(new Set());
      toast({
        title: removed.length > 1 ? `已删除 ${removed.length} 篇` : "已放入回收站",
        description: "词汇收藏和复习进度会保留。",
        action: <button type="button" className="text-sm text-copper" onClick={() => undoDelete(removed)}>撤销</button>,
      });
      setRefresh((n) => n + 1);
    } catch { toast({ title: "删除失败", description: "只能删除自己导入的文章", variant: "destructive" }); }
  };

  const openEditor = (id) => {
    getLibraryArticle(id, { includeDeleted: false }).then((row) => {
      if (!row) { toast({ title: "无法编辑这篇", variant: "destructive" }); return; }
      setEditing(row);
    }).catch(() => toast({ title: "文章加载失败", variant: "destructive" }));
  };

  if (loadingEdit) return <div className="flex justify-center py-20"><Loader2 className="animate-spin" /></div>;
  if (editing) {
    return <ArticleLinkImporter article={editing} onReady={() => { setEditing(null); onCloseEditor?.(); setRefresh((n) => n + 1); }} onCancel={() => { setEditing(null); onCloseEditor?.(); }} />;
  }

  return (
    <section className="mt-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onImport} className="min-h-11 rounded-full bg-copper px-5 text-sm text-copper-foreground">导入文章</button>
        <button type="button" onClick={() => setRefresh((n) => n + 1)} className="text-sm text-muted-foreground">刷新</button>
        <button type="button" onClick={() => { setManageMode((value) => !value); setSelected(new Set()); }} aria-pressed={manageMode} className={`min-h-9 rounded-full border px-4 text-xs ${manageMode ? "border-copper/60 bg-copper/10 text-foreground" : "border-border text-muted-foreground"}`}>
          {manageMode ? "完成整理" : "整理"}
        </button>
        <button type="button" onClick={() => setShowBin((value) => !value)} className="text-sm text-muted-foreground">{showBin ? "返回文章" : `回收站${bin.length ? ` (${bin.length})` : ""}`}</button>
        {manageMode && <button type="button" disabled={!selected.size} onClick={() => removeLibrary([...selected])} className="min-h-9 rounded-full border border-border px-4 text-xs text-muted-foreground disabled:opacity-40">删除所选</button>}
      </div>
      {!user ? <p>登录后可导入并阅读自己的文章。<Link to="/login" className="ml-2 text-copper">登录</Link></p> : showBin ? (
        !bin.length ? <p className="py-12 text-center text-muted-foreground">回收站是空的。</p> : (
          <div className="space-y-4">
            {bin.map((row) => (
              <article key={row.id} className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-lg">{row.title}</h2>
                <p className="mt-2 text-xs text-muted-foreground">删除于 {row.deleted_at?.slice(0, 16)?.replace("T", " ")}</p>
                <button type="button" onClick={() => undoDelete([row.id])} className="mt-4 min-h-9 rounded-full bg-copper px-4 text-xs text-copper-foreground">恢复</button>
              </article>
            ))}
          </div>
        )
      ) : (
        <>
          <FolderBar
            folders={folders}
            activeFolder={activeFolder}
            counts={counts}
            onSelect={setActiveFolder}
            onCreate={createFolder}
            onRename={renameFolder}
            onSetCover={setCover}
            onDelete={deleteFolder}
            onDropToFolder={(folderId, itemId) => moveToFolder(itemId, folderId)}
            canManage={manageMode}
          />
          {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin" aria-label="正在加载文章" /></div>
            : error ? <p role="alert" className="py-12 text-center text-muted-foreground">加载失败：{error}</p>
            : !rows.length ? <p className="py-12 text-center text-muted-foreground">还没有学习文章。粘贴链接和英文正文，开始精读吧。</p>
            : !visible.length ? <p className="py-12 text-center text-muted-foreground">{activeFolder === FAVORITES_FOLDER ? "还没有收藏的文章。" : "此文件夹中没有文章。"}</p>
            : (
              <div className="mt-4 space-y-4">
                {visible.map((row) => (
                  <article
                    key={row.key}
                    data-origin={row.origin}
                    draggable={manageMode}
                    onDragStart={(event) => { if (manageMode) event.dataTransfer.setData("text/plain", row.key); }}
                    className="rounded-2xl border border-border bg-card p-5"
                  >
                    <div className="flex items-start gap-3">
                      {manageMode && row.origin === "library" && (
                        <input type="checkbox" checked={selected.has(row.id)} aria-label={`选择${row.title}`} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} className="mt-2" />
                      )}
                      <Link to={row.href} className="min-w-0 flex-1">
                        <h2 className="text-lg text-foreground">{row.title}</h2>
                      </Link>
                      <button type="button" onClick={() => favorite(row)} disabled={pending.has(row.key)} aria-label={row.favorited ? "取消收藏文章" : "收藏文章"} aria-pressed={row.favorited} className="grid h-9 w-9 place-items-center disabled:opacity-50">
                        <Heart size={18} className={row.favorited ? "text-rose-400" : "text-muted-foreground"} fill={row.favorited ? "currentColor" : "none"} />
                      </button>
                      {row.origin === "library" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label="文章菜单" className="grid h-9 w-9 place-items-center text-muted-foreground"><MoreHorizontal size={18} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEditor(row.id)}><Pencil size={14} /> 编辑</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => removeLibrary([row.id])}><Trash2 size={14} /> 删除</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span>{row.origin === "daily" ? "推荐" : "导入"}</span>
                      <span> · {row.outlet || articleDomain(row.source_url) || "文章"}</span>
                      {row.level && <span> · {row.level}</span>}
                      <span> · {row.read_at ? "已读" : "未读"}</span>
                    </p>
                    {row.summary_zh && <p className="mt-3 text-sm text-muted-foreground">{row.summary_zh}</p>}
                    <Link to={row.href} className="mt-4 inline-flex min-h-9 items-center rounded-full bg-copper px-4 text-xs text-copper-foreground">{row.read_at ? "继续阅读" : "开始阅读"}</Link>
                  </article>
                ))}
              </div>
            )}
        </>
      )}
    </section>
  );
}
