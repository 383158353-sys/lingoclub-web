const HEAVY_LOCAL_FIELDS = [
  "video_blob", "videoBlob", "video_file", "videoFile", "poster_blob", "posterBlob", "cover_blob", "coverBlob",
  "subtitle_text", "subtitleText", "subtitle_cues", "subtitleCues", "poster_data", "posterData", "cover_data", "coverData", "file",
  "video_data", "videoData", "video_base64", "videoBase64", "poster_base64", "posterBase64", "cover_base64", "coverBase64",
  "subtitle_file", "subtitleFile", "subtitle_data", "subtitleData", "cue_array", "cueArray",
  "video_handle", "videoHandle", "subtitle_handle", "subtitleHandle", "directory_handle", "directoryHandle", "subtitleDirectoryHandle",
];

function isBlob(value) {
  return (typeof Blob !== "undefined" && value instanceof Blob)
    || (typeof File !== "undefined" && value instanceof File);
}

function isLocalMovie(movie) {
  const url = String(movie?.video_url || "");
  if (/youtube\.com|youtu\.be/i.test(url)) return false;
  return !url || url.startsWith("blob:") || movie?.media_type === "episode";
}

export function safeMovie(movie, { dropLocalSubtitles = Boolean(movie?.subtitle_id) } = {}) {
  const result = { ...movie };
  for (const key of HEAVY_LOCAL_FIELDS) delete result[key];
  for (const [key, value] of Object.entries(result)) {
    if (isBlob(value)) delete result[key];
  }
  if (typeof result.video_url === "string" && result.video_url.startsWith("blob:")) result.video_url = "";
  if (isLocalMovie(result)) {
    if (typeof result.poster_url === "string" && /^(?:blob:|data:image\/)/i.test(result.poster_url)) result.poster_url = "";
    if (dropLocalSubtitles) {
      const count = Array.isArray(result.subtitles) ? result.subtitles.length : Number(result.subtitle_count) || 0;
      delete result.subtitles;
      delete result.subtitle_text;
      delete result.subtitleText;
      delete result.subtitle_cues;
      delete result.subtitleCues;
      if (count && !result.subtitle_id) result.subtitle_id = result.id;
      if (count) result.subtitle_count = count;
    }
  }
  return result;
}

export function safeFolder(folder) {
  const result = { ...folder };
  const isLocal = result.tab_type === "films" || !result.tab_type;
  if (isLocal) {
    if (typeof result.cover_url === "string" && /^(?:blob:|data:image\/)/i.test(result.cover_url)) result.cover_url = "";
    for (const key of ["cover_blob", "coverBlob", "poster_blob", "posterBlob", "cover_data", "coverData"]) delete result[key];
    for (const key of ["cover_base64", "coverBase64", "poster_base64", "posterBase64", "file"]) delete result[key];
    for (const [key, value] of Object.entries(result)) if (isBlob(value)) delete result[key];
  }
  return result;
}

export function lightweightCloudState(state = {}) {
  return {
    ...state,
    movies: Array.isArray(state.movies) ? state.movies.map((movie) => safeMovie(movie, { dropLocalSubtitles: isLocalMovie(movie) })) : [],
    folders: Array.isArray(state.folders) ? state.folders.map(safeFolder) : [],
  };
}
