import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";

async function loadModule(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": path.resolve("src") }, plugins: [{ name: "isolated-source-dependencies", setup(builder) {
    builder.onResolve({ filter: /supabaseClient|localStudyMeta|vocabRepository/ }, (args) => ({ path: args.path, namespace: "source-test" }));
    builder.onLoad({ filter: /.*/, namespace: "source-test" }, (args) => ({ contents: args.path.includes("supabaseClient") ? "export const supabase = null;" : args.path.includes("localStudyMeta") ? "export const localMovies = { get: async () => { throw new Error('unexpected local lookup'); } };" : "const entries=[]; export const vocabRepository = {list:async()=>entries,createWord:async(payload)=>{const entry={id:String(entries.length),...payload};entries.push(entry);return entry},updateWord:async(id,fields)=>{const entry=entries.find(row=>row.id===id);Object.assign(entry,fields);return entry}};" }));
  } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
test("article vocabulary sources survive without subtitle context", async () => {
  const { buildVocabularySource } = await loadModule("src/lib/vocabularySources.js");
  const source = buildVocabularySource({ source_type: "article", source_record_id: "article-id", source_url: "https://example.com/read", source_movie_title: "Article", type: "word", expression_en: "word" });
  assert.equal(source.source_type, "article"); assert.equal(source.source_record_id, "article-id"); assert.equal(source.source_url, "https://example.com/read"); assert.equal(source.source_movie_title, "Article");
});
test("article source navigation bypasses local and video paths", async () => {
  const { openVocabularySource } = await loadModule("src/lib/vocabularySourceNavigation.js");
  const paths = [];
  assert.equal(await openVocabularySource({ source_type: "article", source_record_id: "article-id" }, (url) => paths.push(url)), true);
  assert.deepEqual(paths, ["/articles/article-id"]);
  await openVocabularySource({ source_type: "library_article", source_record_id: "library-id" }, (url) => paths.push(url));
  assert.equal(paths.pop(), "/library-articles/library-id");
  await openVocabularySource({ source_episode_id: "episode-id" }, (url) => paths.push(url));
  assert.match(paths[1], /^\/episode\/episode-id\?/);
});
test("word, phrase and sentence saves retain article provenance and merge repeated saves", async () => {
  const { saveVocabularyEntry } = await loadModule("src/lib/vocabularySources.js");
  for (const type of ["word", "phrase", "sentence"]) {
    const payload = { type, expression_en: `article ${type}`, source_type: "article", source_record_id: "article-1", source_url: "https://example.com/read", source_movie_title: "Morning read" };
    const first = await saveVocabularyEntry(payload);
    assert.equal(first.entry.type, type); assert.equal(first.entry.sources[0].source_record_id, "article-1");
    const repeated = await saveVocabularyEntry(payload);
    assert.equal(repeated.entry.id, first.entry.id); assert.equal(repeated.entry.sources.length, 1);
    const another = await saveVocabularyEntry({ ...payload, source_record_id: "article-2" });
    assert.equal(another.entry.sources.length, 2);
  }
});
