import { localMovies } from "@/lib/localStudyMeta";
import { resolveVocabularySourceCue } from "@/lib/vocabularySourceCue";
import { toSec } from "@/lib/timecode";

function youtubeId(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1).split("/")[0];
    if (url.pathname === "/watch") return url.searchParams.get("v") || "";
    const match = url.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/);
    return match?.[1] || "";
  } catch { return ""; }
}

export async function openVocabularySource(source, navigate, onUnavailable = () => {}, { returnContext = "collection" } = {}) {
  const recordId = source?.source_record_id || source?.source_movie_id || source?.source_episode_id;
  let cueData = resolveVocabularySourceCue(source);
  let movie = null;
  if (recordId) {
    try {
      movie = await localMovies.get(recordId);
      cueData = resolveVocabularySourceCue(source, Array.isArray(movie?.subtitles) ? movie.subtitles : []);
    } catch { /* source snapshot and timestamp remain usable without local metadata */ }
  }
  const sourceStart = cueData.start ?? source?.source_time_start ?? source?.source_timestamp_seconds ?? source?.timestamp;
  const parsed = Number(sourceStart);
  const seconds = Math.max(0, Number.isFinite(parsed) ? parsed : toSec(sourceStart) || 0);
  const cue = source?.source_subtitle_id || cueData.id || "";
  const params = new URLSearchParams({ t: String(seconds) });
  if (cue) params.set("cue", cue);
  if (Number.isFinite(cueData.end)) params.set("cueEnd", String(cueData.end));
  params.set("closeReading", "1");
  params.set("returnContext", ["review", "mistakes", "collection"].includes(returnContext) ? returnContext : "collection");
  if (recordId) {
    const exists = Boolean(movie);
    if (exists) {
      params.set("open", recordId);
      navigate(`/local-study?${params}`);
      return true;
    }
  }
  if (source?.source_episode_id) {
    navigate(`/episode/${encodeURIComponent(source.source_episode_id)}?${params}`);
    return true;
  }
  const id = source?.source_video_id || youtubeId(source?.source_url);
  if (source?.source_type === "youtube" && id) {
    const url = new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
    url.searchParams.set("t", `${Math.floor(seconds)}s`);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    return true;
  }
  onUnavailable("当前设备没有这部影片；原台词和时间戳仍保存在词条中。");
  return false;
}
