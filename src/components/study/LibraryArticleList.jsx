import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { listDailyArticles, setArticleFavorite, setArticleFolder } from "@/lib/dailyArticles";
import { listLibraryArticles, setLibraryArticleFavorite, setLibraryArticleFolder } from "@/lib/libraryArticles";
import { articleDomain } from "@/lib/dailyArticlesFormat";
import { mergeStudyArticles } from "@/lib/articleLibrary";
import { FAVORITES_FOLDER, itemsInLibraryFolder, libraryFolderCounts, nextFavorited } from "@/lib/libraryFilters";
import { localFolders } from "@/lib/localStudyMeta";
import FolderBar from "@/components/study/FolderBar";

const ARTICLE_TAB = "articles";

export default function LibraryArticleList({ onImport }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(new Set());
  const [activeFolder, setActiveFolder] = useState("all");
  const [manageMode, setManageMode] = useState(false);

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
    ]).then(([libraryResult, dailyResult]) => {
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
    }).finally(() => { if (active) setLoading(false); });
    loadFolders();
    return () => { active = false; };
  }, [user?.id, refresh, loadFolders]);

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

  return (
    <section className="mt-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onImport} className="min-h-11 rounded-full bg-copper px-5 text-sm text-copper-foreground">导入文章</button>
        <button type="button" onClick={() => setRefresh((n) => n + 1)} className="text-sm text-muted-foreground">刷新</button>
        <button type="button" onClick={() => setManageMode((value) => !value)} aria-pressed={manageMode} className={`min-h-9 rounded-full border px-4 text-xs ${manageMode ? "border-copper/60 bg-copper/10 text-foreground" : "border-border text-muted-foreground"}`}>
          {manageMode ? "完成整理" : "整理"}
        </button>
      </div>
      {!user ? <p>登录后可导入并阅读自己的文章。<Link to="/login" className="ml-2 text-copper">登录</Link></p> : (
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
                      <Link to={row.href} className="min-w-0 flex-1">
                        <h2 className="text-lg text-foreground">{row.title}</h2>
                      </Link>
                      <button type="button" onClick={() => favorite(row)} disabled={pending.has(row.key)} aria-label={row.favorited ? "取消收藏文章" : "收藏文章"} aria-pressed={row.favorited} className="grid h-9 w-9 place-items-center disabled:opacity-50">
                        <Heart size={18} className={row.favorited ? "text-rose-400" : "text-muted-foreground"} fill={row.favorited ? "currentColor" : "none"} />
                      </button>
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
