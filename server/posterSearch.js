const DOUBAN_SUGGEST = "https://movie.douban.com/j/subject_suggest";
const TVMAZE_SEARCH = "https://api.tvmaze.com/search/shows";
const TMDB_API = "https://api.themoviedb.org/3";
const PROVIDER_TIMEOUT_MS = 2800;

async function runProvider(operation) {
  let timeoutId;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("Provider timeout")), PROVIDER_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timeoutId); }
}

async function getJson(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), headers });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

function imageUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith("." + host)) ? url.href : "";
  } catch { return ""; }
}

function dedupe(candidates) {
  const map = new Map();
  for (const candidate of candidates) if (candidate && !map.has(candidate.id)) map.set(candidate.id, candidate);
  return [...map.values()].slice(0, 5);
}

function mapDouban(item) {
  const poster = imageUrl(String(item?.img || "").replace(/^http:\/\//i, "https://"), ["doubanio.com"]);
  if (!item?.id || !poster) return null;
  return {
    id: "douban:" + item.id,
    title: String(item.title || item.sub_title || "豆瓣条目"),
    originalTitle: String(item.sub_title || ""),
    year: String(item.year || ""),
    imageUrl: poster,
    doubanUrl: "https://movie.douban.com/subject/" + encodeURIComponent(item.id) + "/",
    provider: "douban",
    type: String(item.type || ""),
    episode: String(item.episode || ""),
  };
}

function seasonMatches(candidate, seasonNumber) {
  const num = String(Number(seasonNumber));
  const title = (candidate.title + " " + (candidate.originalTitle || "") + " " + (candidate.episode || "")).toLowerCase();
  const chinese = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九", 10: "十" }[Number(seasonNumber)];
  return Boolean(chinese && new RegExp("第\\s*" + chinese + "\\s*季").test(title))
    || new RegExp("(?:第\\s*0*" + num + "\\s*季|season\\s*0*" + num + "(?:\\b|$)|s0*" + num + "(?:e|\\b|$)|\\b0*" + num + "(?:st|nd|rd|th)\\s+season\\b)", "i").test(title);
}

async function doubanSuggestions(query, fetchImpl) {
  const response = await getJson(DOUBAN_SUGGEST + "?q=" + encodeURIComponent(query), fetchImpl, {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://movie.douban.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
  });
  return Array.isArray(response) ? response : [];
}

async function searchDouban(query, type, seasonNumber, fetchImpl) {
  if (type === "movie") {
    const items = await doubanSuggestions(query, fetchImpl);
    return { candidates: dedupe(items.filter((item) => !item.type || item.type === "movie").map(mapDouban)), usedSeriesFallback: false };
  }
  const hasSeason = Number.isInteger(Number(seasonNumber)) && Number(seasonNumber) > 0 && Number(seasonNumber) <= 99;
  if (hasSeason) {
    const searches = await Promise.all([
      doubanSuggestions(query + " 第" + seasonNumber + "季", fetchImpl),
      doubanSuggestions(query + " Season " + seasonNumber, fetchImpl),
    ]);
    const seasons = dedupe(searches.flat().filter((item) => !item.type || item.type === "tv" || item.type === "movie")
      .map(mapDouban).filter((candidate) => seasonMatches(candidate, seasonNumber)))
      .map((candidate) => ({ ...candidate, source: "season" }));
    if (seasons.length) return { candidates: seasons, usedSeriesFallback: false };
  }
  const items = await doubanSuggestions(query, fetchImpl);
  return {
    candidates: dedupe(items.filter((item) => !item.type || item.type === "tv" || item.type === "movie").map(mapDouban))
      .map((candidate) => ({ ...candidate, source: "series" })),
    usedSeriesFallback: true,
  };
}

async function searchTvmaze(query, seasonNumber, fetchImpl) {
  const result = await getJson(TVMAZE_SEARCH + "?q=" + encodeURIComponent(query), fetchImpl);
  if (!Array.isArray(result)) return [];
  const candidates = await Promise.all(result.slice(0, 5).map(async ({ show }) => {
    if (!show?.id) return null;
    let season;
    const hasSeason = Number.isInteger(Number(seasonNumber)) && Number(seasonNumber) > 0 && Number(seasonNumber) <= 99;
    if (hasSeason) {
      try {
        const seasons = await getJson("https://api.tvmaze.com/shows/" + encodeURIComponent(show.id) + "/seasons", fetchImpl);
        season = Array.isArray(seasons) ? seasons.find((item) => Number(item.number) === Number(seasonNumber)) : null;
      } catch { /* Fall back to the show poster if season lookup is unavailable. */ }
    }
    const poster = imageUrl(season?.image?.original || season?.image?.medium || show.image?.original || show.image?.medium, ["tvmaze.com"]);
    if (!poster) return null;
    return {
      id: "tvmaze:" + show.id + ":" + (season?.id || (hasSeason ? seasonNumber : "series")),
      title: show.name || "TV series",
      originalTitle: show.name || "",
      year: String(show.premiered || "").slice(0, 4),
      imageUrl: poster,
      provider: "tvmaze",
      source: season?.image ? "season" : "series",
      seasonNumber,
      externalUrl: show.url,
    };
  }));
  return candidates;
}

async function searchTmdb(query, type, seasonNumber, env, fetchImpl) {
  const key = String(env.TMDB_API_KEY || "").trim();
  if (!key) return [];
  const entity = type === "movie" ? "movie" : "tv";
  const result = await getJson(TMDB_API + "/search/" + entity + "?query=" + encodeURIComponent(query) + "&include_adult=false&api_key=" + encodeURIComponent(key), fetchImpl);
  const rows = Array.isArray(result?.results) ? result.results : [];
  const candidates = await Promise.all((type === "tv" ? rows.slice(0, 5) : rows).map(async (item) => {
    let posterPath = item.poster_path;
    let source = type === "tv" ? "series" : "movie";
    const hasSeason = Number.isInteger(Number(seasonNumber)) && Number(seasonNumber) > 0 && Number(seasonNumber) <= 99;
    if (type === "tv" && hasSeason) {
      try {
        const season = await getJson(TMDB_API + "/tv/" + encodeURIComponent(item.id) + "/season/" + Number(seasonNumber) + "?api_key=" + encodeURIComponent(key), fetchImpl);
        if (season?.poster_path) { posterPath = season.poster_path; source = "season"; }
      } catch { /* Show poster remains a valid fallback. */ }
    }
    const poster = imageUrl("https://image.tmdb.org/t/p/w500" + (posterPath || ""), ["tmdb.org"]);
    if (!item?.id || !posterPath || !poster) return null;
    return {
      id: "tmdb:" + item.id + (type === "tv" ? (hasSeason ? ":s" + seasonNumber : ":series") : ""),
      title: item.title || item.name || "TMDB item",
      originalTitle: item.original_title || item.original_name || "",
      year: String(item.release_date || item.first_air_date || "").slice(0, 4),
      imageUrl: poster,
      provider: "tmdb",
      source,
      externalUrl: "https://www.themoviedb.org/" + entity + "/" + item.id,
    };
  }));
  return candidates;
}

export async function searchLocalPosters({ query, type = "movie", seasonNumber }, env = process.env, fetchImpl = fetch) {
  const title = String(query || "").trim();
  if (!title) return { candidates: [], provider: null, providersAttempted: [] };
  if (type !== "movie" && type !== "tv") throw new Error("Unsupported poster type");
  const requestedSeason = Number(seasonNumber);
  const season = type === "tv" && Number.isInteger(requestedSeason) && requestedSeason >= 1 && requestedSeason <= 99 ? requestedSeason : null;
  const providersAttempted = [];
  const providers = [];
  if (type === "tv") providers.push({ name: "tvmaze", run: () => searchTvmaze(title, season, fetchImpl) });
  if (String(env.TMDB_API_KEY || "").trim()) providers.push({ name: "tmdb", run: () => searchTmdb(title, type, season, env, fetchImpl) });
  providers.push({
    name: "douban",
    run: async () => {
      const result = await searchDouban(title, type, season, fetchImpl);
      return result.candidates.map((candidate) => ({ ...candidate, source: candidate.source || (type === "tv" ? "series" : "movie") }));
    },
  });
  for (const provider of providers) {
    providersAttempted.push(provider.name);
    try {
      const candidates = dedupe(await runProvider(provider.run));
      if (candidates.length) return {
        candidates,
        provider: provider.name,
        providersAttempted,
        usedSeriesFallback: type === "tv" && candidates.every((item) => item.source === "series"),
      };
    } catch (error) {
      const reason = error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "timeout"
        : String(error?.message || "request failed").slice(0, 100);
      providersAttempted[providersAttempted.length - 1] = provider.name + ": " + reason;
    }
  }
  return { candidates: [], provider: null, providersAttempted };
}

export function isAllowedPosterUrl(value) {
  return Boolean(imageUrl(value, ["doubanio.com", "tvmaze.com", "tmdb.org"]));
}

export const isAllowedDoubanPosterUrl = (value) => Boolean(imageUrl(value, ["doubanio.com"]));

export async function fetchDoubanPoster(url, fetchImpl = fetch) {
  if (!isAllowedPosterUrl(url)) throw new Error("Only trusted HTTPS poster URLs are allowed");
  const host = new URL(url).hostname;
  const referer = host.endsWith("doubanio.com") ? "https://movie.douban.com/" : "https://www.themoviedb.org/";
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Referer: referer, "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error("Poster returned HTTP " + response.status);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error("Poster provider did not return an image");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error("Poster size is invalid");
  return { bytes, contentType };
}
