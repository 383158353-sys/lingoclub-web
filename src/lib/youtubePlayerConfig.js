export function createYouTubePlayerVars(origin) {
  return {
    rel: 0,
    modestbranding: 1,
    autoplay: 0,
    playsinline: 1,
    enablejsapi: 1,
    ...(origin ? { origin } : {}),
  };
}

export function createYouTubeEmbedUrl(videoId, origin) {
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(createYouTubePlayerVars(origin)).map(([key, value]) => [key, String(value)])),
  });
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params}`;
}
