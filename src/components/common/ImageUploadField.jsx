import React, { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";

// 单图上传字段：点击选择文件 → UploadFile 返回 file_url；左侧为预览缩略图。
export default function ImageUploadField({ label, value, onChange, hint, aspect = "2/3" }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      onChange(file_url);
    } catch {
      /* ignore — 上传失败时保持空值 */
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <span className="text-[11px] uppercase tracking-luxe text-muted-foreground">{label}</span>
      <div className="mt-1.5 flex items-start gap-3">
        <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-background-elev/50" style={{ width: 72, aspectRatio: aspect }}>
          {value ? (
            <Image src={value} alt="" fittingType="fill" className="h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            </div>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background-elev/50 px-3 py-1.5 text-xs text-foreground hover:border-copper/40 disabled:opacity-50"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? "上传中…" : "选择文件"}
            </button>
            {value && (
              <button type="button" onClick={() => onChange("")} className="text-xs text-muted-foreground hover:text-foreground" title="移除图片">
                <X size={14} />
              </button>
            )}
          </div>
          {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">{hint}</p>}
          {value && <p className="mt-1 max-w-[200px] truncate font-mono text-[10px] text-muted-foreground/50">{value.split("/").pop()}</p>}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleSelect} />
      </div>
    </div>
  );
}