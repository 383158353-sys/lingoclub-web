import assert from "node:assert/strict";
import test from "node:test";
import { getYouTubeMeta, handleYouTubeMeta, titleFromWatchHtml } from "./youtubeMeta.js";
import { isPlaceholderVideoTitle } from "../src/lib/videoTitle.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("watch page title parsing", () => {
  assert.equal(titleFromWatchHtml('<meta name="title" content="Stop Translating! How to &amp; Think">'), "Stop Translating! How to & Think");
  assert.equal(titleFromWatchHtml("<title>My Video - YouTube</title>"), "My Video");
  assert.equal(titleFromWatchHtml("<title>YouTube</title>"), "");
});

test("embeddable video: title from oEmbed", async () => {
  const meta = await getYouTubeMeta("https://youtu.be/AAAAAAAAAB1", {}, { useCache: false, fetchImpl: async (url) => {
    assert.match(String(url), /oembed/);
    return json({ title: "Real Title", thumbnail_url: "https://i.ytimg.com/x.jpg", author_name: "Chan" });
  } });
  assert.deepEqual([meta.title, meta.titleSource, meta.embeddable], ["Real Title", "oembed", true]);
});

test("embedding disabled: oEmbed 401 → watch page title, embeddable=false", async () => {
  const meta = await getYouTubeMeta("AAAAAAAAAB2", {}, { useCache: false, fetchImpl: async (url) => {
    if (String(url).includes("oembed")) return new Response("Unauthorized", { status: 401 });
    return new Response('<meta name="title" content="Stop Translating!">', { status: 200 });
  } });
  assert.deepEqual([meta.title, meta.titleSource, meta.embeddable], ["Stop Translating!", "watch-page", false]);
});

test("watch page blocked: Supadata metadata used only when configured", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(String(url)).host);
    if (String(url).includes("oembed")) return new Response("Unauthorized", { status: 401 });
    if (String(url).includes("supadata")) return json({ title: "From Supadata", thumbnail: "t.jpg" });
    return new Response("<html>Sign in to confirm you’re not a bot</html>", { status: 200 });
  };
  const withKey = await getYouTubeMeta("AAAAAAAAAB3", { SUPADATA_API_KEY: "k" }, { useCache: false, fetchImpl });
  assert.deepEqual([withKey.title, withKey.titleSource], ["From Supadata", "supadata"]);
  calls.length = 0;
  const withoutKey = await getYouTubeMeta("AAAAAAAAAB3", {}, { useCache: false, fetchImpl });
  assert.equal(withoutKey.title, "");
  assert.ok(!calls.includes("api.supadata.ai"));
});

test("meta handler rejects invalid links", async () => {
  const res = { end(body) { this.body = JSON.parse(body); } };
  await handleYouTubeMeta({}, res, { url: "https://example.com" }, {});
  assert.equal(res.statusCode, 400);
});

test("placeholder titles are detected but real titles are kept", () => {
  for (const title of ["", "YouTube 视频", "快速导入视频", "未命名影片", "https://youtu.be/F3hc7lN2S6k"]) assert.equal(isPlaceholderVideoTitle(title), true, title);
  for (const title of ["Stop Translating!", "我的精读"]) assert.equal(isPlaceholderVideoTitle(title), false, title);
});
