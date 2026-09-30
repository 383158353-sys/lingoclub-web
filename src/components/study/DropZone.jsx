import React, { useRef, useState } from "react";
import { Upload } from "lucide-react";

// 拖拽上传区：支持拖拽文件与点击选择。点击/拖拽均触发 onFile(file)。
// `preview` 提供时显示图片预览（用于海报），否则展示 图标 + placeholder/selectedLabel。
export default function DropZone({ accept, onFile, placeholder, selectedLabel, preview, icon: Icon = Upload, className = "" }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const item = Array.from(e.dataTransfer.items || []).find((entry) => entry.kind === "file");
    if (item) {
      try {
        const handle = await item.getAsFileSystemHandle?.();
        if (handle?.kind === "file") { onFile(await handle.getFile(), handle); return; }
      } catch { /* Fall back to a transient File; callers must not persist its Blob. */ }
    }
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f, null);
  };

  return (
    <div
      type="button"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
      tabIndex={0}
      role="button"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`group flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed bg-background/40 px-4 text-center text-sm transition-colors ${dragging ? "border-copper bg-copper/10 text-foreground" : "border-border text-muted-foreground hover:border-copper/50 hover:text-foreground"} ${className}`}
    >
      {preview ? (
        <img src={preview} alt="预览" className="max-h-44 rounded-md object-contain" />
      ) : (
        <>
          <Icon size={18} className="shrink-0" />
          <span className="break-all">{selectedLabel || placeholder}</span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f, null); e.target.value = ""; }}
      />
    </div>
  );
}
