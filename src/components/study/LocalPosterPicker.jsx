import React, { useState } from "react";
import { ImagePlus, Loader2, Search, Upload } from "lucide-react";

export default function LocalPosterPicker({ title, type = "movie", onSelect, selectedUrl = "", allowSkip = true }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [message, setMessage] = useState("");

  const search = async () => {
    const searchText = (query.trim() || title || "").trim();
    if (!searchText) { setMessage("请先填写影片名"); return; }
    setBusy(true);
    setMessage("");
    setCandidates([]);
    try {
      const params = new URLSearchParams({ query: searchText, type });
      const response = await fetch(`/api/poster-search?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "封面搜索暂时不可用");
      setCandidates(result.candidates || []);
      if (result.usedSeriesFallback && (result.candidates || []).length) setMessage("未找到季度专属封面，以下为剧集主封面候选。");
      else if (!(result.candidates || []).length) setMessage("暂未找到封面，可以手动上传；也可以不设置封面继续导入。");
    } catch {
      setMessage("暂未找到封面，可以上传自己的封面");
    } finally {
      setBusy(false);
    }
  };

  const chooseCandidate = async (candidate) => {
    setCacheBusy(true);
    try {
      const response = await fetch(`/api/douban-poster?url=${encodeURIComponent(candidate.imageUrl)}`);
      if (response.ok) {
        const file = await response.blob();
        onSelect({ file, url: URL.createObjectURL(file), sourceUrl: candidate.imageUrl });
      } else {
        onSelect({ url: candidate.imageUrl, file: null, sourceUrl: candidate.imageUrl });
      }
    } catch {
      // If local caching is unavailable, preserve the HTTPS provider image URL.
      onSelect({ url: candidate.imageUrl, file: null, sourceUrl: candidate.imageUrl });
    } finally { setCacheBusy(false); }
  };

  const selectFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("请选择图片文件"); return; }
    onSelect({ file, url: URL.createObjectURL(file) });
  };

  return (
    <section className="rounded-xl border border-border/70 p-3" aria-label="封面">
      <div className="flex items-center gap-2">
        <ImagePlus size={15} className="text-copper" />
        <span className="text-xs font-medium text-foreground">封面（可选）</span>
        <div className="ml-auto flex items-center gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={type === "tv" ? title || "项目名称" : title || "输入影片名"} className="w-36 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
          <button type="button" onClick={search} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-xs text-foreground disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} 自动查找
          </button>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
      {!!candidates.length && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {candidates.map((candidate) => (
            <button type="button" key={candidate.id} disabled={cacheBusy} onClick={() => chooseCandidate(candidate)} className={`w-20 shrink-0 overflow-hidden rounded-lg border text-left disabled:opacity-60 ${selectedUrl === candidate.imageUrl ? "border-copper" : "border-border"}`} title={`使用：${candidate.title}`}>
              <img src={candidate.imageUrl} alt={candidate.title} className="aspect-[2/3] w-full object-cover" />
              <span className="block truncate px-1 pt-1 text-[10px] text-foreground">{candidate.title}</span>
              <span className="block truncate px-1 pb-1 text-[9px] text-muted-foreground">{[candidate.originalTitle, candidate.year, candidate.source === "series" ? "剧集主封面" : candidate.source === "season" ? "季度封面" : "", candidate.provider === "tvmaze" ? "TVmaze" : candidate.provider === "tmdb" ? "TMDB" : candidate.provider === "douban" ? "豆瓣" : ""].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3">
        {selectedUrl && <img src={selectedUrl} alt="已选封面" className="h-16 w-11 rounded object-cover" />}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Upload size={12} /> 上传自己的封面
          <input type="file" accept="image/*" className="sr-only" onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {allowSkip && <span className="text-[11px] text-muted-foreground">不设置也可继续</span>}
      </div>
    </section>
  );
}
