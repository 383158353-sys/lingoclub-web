import { localMovies } from "@/lib/localStudyMeta";
import { articleReturnPath } from "@/lib/sourceSentenceFocus";
import { planVocabularyRecall, youtubePlaybackUrl } from "@/lib/vocabularySourceCue";

export async function openVocabularySource(source, navigate, onUnavailable = () => {}, { returnContext = "collection" } = {}) {
  if ((source?.source_type === "library_article" || source?.source_type === "article") && source?.source_record_id) {
    navigate(articleReturnPath(source));
    return true;
  }
  const recordId = source?.source_record_id || source?.source_movie_id;
  let movie = null;
  if (recordId) {
    try { movie = await localMovies.get(recordId); } catch { /* timestamp recall still works from the saved source */ }
  }
  const direct = youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id, source?.source_url, source?.source_video_id);
  let movies = [];
  // Episode routes stay on the episode page. A linked local file is not scanned for a YouTube id.
  const linkedLocal = Boolean(movie) && !youtubePlaybackUrl(movie?.video_url, movie?.youtube_video_id);
  if (!movie && !direct && !source?.source_episode_id && !linkedLocal) {
    try { movies = await localMovies.list(); } catch { /* no library to recover a YouTube id from */ }
  }
  const plan = planVocabularyRecall(source, { movie, movies, returnContext });
  if (plan.kind === "unavailable") {
    onUnavailable(plan.message);
    return false;
  }
  navigate(plan.href);
  return true;
}
