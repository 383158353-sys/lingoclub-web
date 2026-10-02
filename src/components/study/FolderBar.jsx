import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, Folder, Pencil, Image as ImageIcon, Trash2, Check, X, Share2, ExternalLink, MoreVertical, EyeOff } from "lucide-react";

/**
 * 文件夹栏：展示文件夹芯片（带封面），支持右键菜单（重命名/封面/删除）、
 * 拖拽视频/影片到文件夹、新建空文件夹。
 */
export default function FolderBar({
  folders,
  activeFolder,
  counts,
  onSelect,
  onCreate,
  onRename,
  onSetCover,
  onDelete,
  onDropToFolder,
  canManage,
  onPublish,
  publishingId,
  onUnpublish,
}) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [dropTarget, setDropTarget] = useState(null);
  const [coverTarget, setCoverTarget] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [menu]);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName("");
    setCreating(false);
  };

  const submitRename = () => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return; }
    onRename(renaming, renameValue.trim());
    setRenaming(null);
    setRenameValue("");
  };

  const handleCoverSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && coverTarget) onSetCover(coverTarget, file);
    setCoverTarget(null);
  };

  const chipBase = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all";
  const chip = (active) => `${chipBase} ${active ? "bg-copper text-copper-foreground" : "border border-border text-muted-foreground hover:text-foreground hover:border-copper/50"}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => onSelect("all")} className={chip(activeFolder === "all")}>全部</button>
      <button type="button" onClick={() => onSelect("uncategorized")} className={chip(activeFolder === "uncategorized")}>
        未分类 {counts.uncategorized > 0 && <span className="opacity-70">{counts.uncategorized}</span>}
      </button>
      {folders.map((f) => (
        <div
          key={f.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(f.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(f.id); } }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropTarget !== f.id) setDropTarget(f.id); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            const itemId = e.dataTransfer.getData("text/plain");
            if (itemId) onDropToFolder(f.id, itemId);
            setDropTarget(null);
          }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, folder: f }); }}
          className={`${chip(activeFolder === f.id)} ${dropTarget === f.id ? "ring-2 ring-copper scale-105" : ""} cursor-pointer`}
        >
          {f.cover_url ? (
            <img src={f.cover_url} alt="" loading="lazy" decoding="async" className="h-4 w-4 rounded-full object-cover" />
          ) : (
            <Folder size={12} />
          )}
          {renaming === f.id ? (
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenaming(null); }}
              onBlur={submitRename}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="w-20 rounded bg-background px-1 py-0 text-copper-foreground outline-none"
            />
          ) : (
            <span>{f.name}</span>
          )}
          {counts[f.id] > 0 && <span className="opacity-70">{counts[f.id]}</span>}
          {f.is_shared && (
            <span className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-mint/15 px-1.5 py-0.5 text-[10px] text-mint" title={f.share_link ? `已发布: ${f.share_link}` : "已发布为小组"}>
              {f.share_link ? <ExternalLink size={9} /> : <Share2 size={9} />} 已共享
            </span>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, folder: f }); }}
            title="文件夹管理"
            className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <MoreVertical size={12} />
          </button>
        </div>
      ))}
      {canManage && (
        creating ? (
          <div className="flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
              placeholder="文件夹名"
              className="w-28 rounded-full border border-border bg-background-elev/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
              autoFocus
            />
            <button type="button" onClick={handleCreate} className="flex h-6 w-6 items-center justify-center rounded-full bg-copper text-copper-foreground"><Check size={12} /></button>
            <button type="button" onClick={() => { setCreating(false); setNewName(""); }} className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground"><X size={12} /></button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-copper/50 hover:text-foreground">
            <FolderPlus size={12} /> 新建文件夹
          </button>
        )
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-[150px] rounded-lg border border-border bg-popover p-1 shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 180) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => { setRenaming(menu.folder.id); setRenameValue(menu.folder.name); setMenu(null); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-copper/10">
            <Pencil size={12} /> 重命名
          </button>
          <button type="button" onClick={() => { setCoverTarget(menu.folder.id); fileInputRef.current?.click(); setMenu(null); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-foreground hover:bg-copper/10">
            <ImageIcon size={12} /> 选择封面
          </button>
          {onPublish && (
            <button type="button" onClick={() => { const f = menu.folder; setMenu(null); navigate(`/publish-folder/${f.id}`); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-mint hover:bg-mint/10">
              {menu.folder.is_shared ? <ExternalLink size={12} /> : <Share2 size={12} />}
              {menu.folder.is_shared ? "编辑小组 / 查看主页" : "发布为共享小组"}
            </button>
          )}
          {menu.folder.is_shared && (
            <button type="button" onClick={() => { onUnpublish?.(menu.folder); setMenu(null); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10">
              <EyeOff size={12} /> 下架小组 / 取消共享
            </button>
          )}
          <div className="my-1 border-t border-border/50" />
          <button type="button" onClick={() => { if (window.confirm(`删除文件夹「${menu.folder.name}」？文件夹内的视频将移至「未分类」。`)) onDelete(menu.folder.id); setMenu(null); }} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">
            <Trash2 size={12} /> 删除文件夹
          </button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverSelect} />
    </div>
  );
}
