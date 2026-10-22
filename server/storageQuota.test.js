import test from "node:test";
import assert from "node:assert/strict";

class MemStorage {
  constructor(limit = Infinity) { this.map = new Map(); this.limit = limit; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  removeItem(k) { this.map.delete(k); }
  used() { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
  setItem(k, v) {
    const prev = this.map.get(k);
    const next = this.used() - (prev ? k.length + prev.length : 0) + k.length + String(v).length;
    if (next > this.limit) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
    this.map.set(k, String(v));
  }
}
globalThis.localStorage = new MemStorage();
const q = await import("../src/lib/storageQuota.js");

test("startup cleanup removes only obsolete cache keys", () => {
  globalThis.localStorage = new MemStorage();
  localStorage.setItem("lingoclub:youtube-transcript:v1:abc", "x");
  localStorage.setItem("lingoclub:youtube-transcript:v2:abc", "merged");
  localStorage.setItem("lingoclub:youtube-transcript:v3:abc", "y");
  localStorage.setItem("lingoclub_local_movies_v1", "[1]");
  assert.equal(q.cleanupObsoleteStorage(), 2);
  assert.equal(localStorage.getItem("lingoclub:youtube-transcript:v2:abc"), null);
  assert.equal(localStorage.getItem("lingoclub:youtube-transcript:v3:abc"), "y");
  assert.equal(localStorage.getItem("lingoclub_local_movies_v1"), "[1]");
});

test("transcript cache is LRU capped at 10 entries", () => {
  globalThis.localStorage = new MemStorage();
  for (let i = 0; i < 15; i += 1) {
    localStorage.setItem(`${q.TRANSCRIPT_CACHE_PREFIX}id${i}`, JSON.stringify({ savedAt: i, usedAt: i, lines: [] }));
  }
  assert.ok(q.writeTranscriptCache("new", [{ text_en: "a", time_start: "1" }]));
  const keys = [...localStorage.map.keys()];
  assert.equal(keys.length, 10);
  assert.ok(keys.includes(`${q.TRANSCRIPT_CACHE_PREFIX}new`));
  assert.ok(!keys.includes(`${q.TRANSCRIPT_CACHE_PREFIX}id0`));
});

test("transcript cache write never throws when storage is full", () => {
  globalThis.localStorage = new MemStorage(100);
  localStorage.setItem("user", "x".repeat(90));
  assert.equal(q.writeTranscriptCache("vid", [{ text_en: "hello", time_start: "1" }]), false);
  assert.equal(localStorage.getItem("user"), "x".repeat(90));
});

test("user data write evicts caches then retries, keeping user data", () => {
  globalThis.localStorage = new MemStorage(400);
  localStorage.setItem("lingoclub:youtube-transcript:v2:a", "c".repeat(200));
  localStorage.setItem("fav", "keep");
  q.setItemWithCacheEviction("movies", "m".repeat(250));
  assert.equal(localStorage.getItem("movies").length, 250);
  assert.equal(localStorage.getItem("fav"), "keep");
  assert.equal(localStorage.getItem("lingoclub:youtube-transcript:v2:a"), null);
  assert.throws(() => q.setItemWithCacheEviction("movies2", "z".repeat(500)), (e) => q.isQuotaError(e));
  assert.equal(localStorage.getItem("movies").length, 250);
});

test("toast dedupe shows a repeated message once", () => {
  assert.equal(q.shouldShowToast("k", 1000), true);
  assert.equal(q.shouldShowToast("k", 2000), false);
  assert.equal(q.shouldShowToast("k", 6000), true);
});
