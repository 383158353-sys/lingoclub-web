import React, { useEffect, useState } from "react";
import { Film } from "lucide-react";

// 海报缩略图：从 blob 生成一次性 objectURL（卸载时 revoke，避免内存泄漏），
// 无海报时回退到占位图标。用于「我的影片」列表海报行。
export default function PosterThumb({ blob, className = "" }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => { try { URL.revokeObjectURL(u); } catch { /* noop */ } };
  }, [blob]);
  if (!url) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-background-elev/40 text-muted-foreground/40 ${className}`}>
        <Film size={28} />
      </div>
    );
  }
  return <img src={url} alt="海报" className={`h-full w-full object-cover ${className}`} />;
}