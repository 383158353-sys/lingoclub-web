import test from "node:test";
import assert from "node:assert/strict";
import { fetchDoubanPoster, isAllowedDoubanPosterUrl, isAllowedPosterUrl, searchLocalPosters } from "./posterSearch.js";

function jsonResponse(data) { return { ok: true, json: async () => data }; }
const doubanItem = (id, title, type = "tv", episode = "") => ({
  id, type, title, episode, img: "https://img3.doubanio.com/poster-" + id + ".jpg",
});

test("TV season poster search prefers TVmaze and uses the season art when available", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/search/shows")) return jsonResponse([{ show: { id: 4, name: "Hacks", image: { original: "https://static.tvmaze.com/show.jpg" } } }]);
    return jsonResponse([{ id: 44, number: 1, image: { original: "https://static.tvmaze.com/season.jpg" } }]);
  };
  const result = await searchLocalPosters({ query: "Hacks", type: "tv", seasonNumber: 1 }, {}, fetchImpl);
  assert.deepEqual(result.providersAttempted, ["tvmaze"]);
  assert.equal(result.provider, "tvmaze");
  assert.equal(result.candidates[0].source, "season");
  assert.equal(result.candidates[0].imageUrl, "https://static.tvmaze.com/season.jpg");
  assert.equal(urls.length, 2);
});

test("TV poster search works from project title without a user-entered season", async () => {
  const urls = [];
  const result = await searchLocalPosters({ query: "绝望写手2", type: "tv" }, {}, async (url) => {
    urls.push(url);
    return jsonResponse([{ show: { id: 8, name: "Hacks", image: { original: "https://static.tvmaze.com/hacks.jpg" } } }]);
  });
  assert.equal(result.provider, "tvmaze");
  assert.equal(result.candidates[0].source, "series");
  assert.equal(result.candidates[0].imageUrl, "https://static.tvmaze.com/hacks.jpg");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes(encodeURIComponent("绝望写手2")));
});

test("TVmaze timeout falls through to Douban without blocking the search", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.includes("api.tvmaze.com")) throw new Error("network timeout");
    const query = decodeURIComponent(url);
    if (query.includes("第2季")) return jsonResponse([doubanItem("s2", "Hacks 第2季")]);
    if (query.includes("Season 2")) return jsonResponse([]);
    return jsonResponse([]);
  };
  const result = await searchLocalPosters({ query: "Hacks", type: "tv", seasonNumber: 2 }, {}, fetchImpl);
  assert.equal(result.provider, "douban");
  assert.equal(result.providersAttempted[0].startsWith("tvmaze: "), true);
  assert.equal(result.providersAttempted[1], "douban");
  assert.equal(result.candidates[0].source, "season");
  assert.ok(requested[0].includes("api.tvmaze.com"));
});

test("TMDB is used before Douban when configured and movie search skips TVmaze", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return jsonResponse({ results: [{ id: 7, title: "Black Swan", original_title: "Black Swan", release_date: "2010-12-03", poster_path: "/swan.jpg" }] });
  };
  const result = await searchLocalPosters({ query: "Black Swan", type: "movie" }, { TMDB_API_KEY: "server-only-key" }, fetchImpl);
  assert.equal(result.provider, "tmdb");
  assert.equal(result.candidates[0].provider, "tmdb");
  assert.equal(result.candidates[0].imageUrl, "https://image.tmdb.org/t/p/w500/swan.jpg");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("api_key=server-only-key"));
});

test("Douban movie search remains the fallback and returns up to five candidates", async () => {
  let requested;
  const records = Array.from({ length: 7 }, (_, index) => ({
    id: String(index + 1), type: "movie", title: "黑天鹅 " + index, sub_title: "Black Swan", year: String(2010 + index),
    img: "https://img3.doubanio.com/p" + index + ".jpg",
  }));
  const result = await searchLocalPosters({ query: "黑天鹅", type: "movie" }, {}, async (url, options) => {
    requested = { url, options };
    return jsonResponse(records);
  });
  assert.equal(new URL(requested.url).hostname, "movie.douban.com");
  assert.equal(new URL(requested.url).searchParams.get("q"), "黑天鹅");
  assert.equal(requested.options.headers.Referer, "https://movie.douban.com/");
  assert.equal(result.candidates.length, 5);
  assert.equal(result.provider, "douban");
  assert.equal(result.candidates[0].originalTitle, "Black Swan");
});

test("Douban season results must match requested season, then use series fallback", async () => {
  const result = await searchLocalPosters({ query: "Hacks", type: "tv", seasonNumber: 2 }, {}, async (url) => {
    const query = new URL(url).searchParams.get("q");
    if (query.includes("Season 2")) return jsonResponse([
      doubanItem("s1", "Hacks Season 1"),
      doubanItem("s2", "Hacks Season 2"),
    ]);
    return jsonResponse([]);
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, "douban:s2");
  assert.equal(result.candidates[0].source, "season");

  const fallback = await searchLocalPosters({ query: "Hacks", type: "tv", seasonNumber: 2 }, {}, async (url) => {
    if (new URL(url).searchParams.get("q") === "Hacks") return jsonResponse([doubanItem("show", "Hacks")]);
    return jsonResponse([]);
  });
  assert.equal(fallback.usedSeriesFallback, true);
  assert.equal(fallback.candidates[0].source, "series");
});

test("all poster providers failing returns an empty choice instead of blocking import", async () => {
  const result = await searchLocalPosters({ query: "missing", type: "tv", seasonNumber: 1 }, {}, async () => { throw new Error("fetch failed"); });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.providersAttempted, ["tvmaze: fetch failed", "douban: fetch failed"]);
});

test("poster cache proxy permits known HTTPS providers only", async () => {
  assert.equal(isAllowedDoubanPosterUrl("https://img3.doubanio.com/p.jpg"), true);
  assert.equal(isAllowedDoubanPosterUrl("http://img3.doubanio.com/p.jpg"), false);
  assert.equal(isAllowedPosterUrl("https://static.tvmaze.com/p.jpg"), true);
  assert.equal(isAllowedPosterUrl("https://image.tmdb.org/t/p/p.jpg"), true);
  assert.equal(isAllowedPosterUrl("https://example.com/p.jpg"), false);
  const result = await fetchDoubanPoster("https://img3.doubanio.com/p.jpg", async () => ({
    ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.bytes.byteLength, 3);
});
