import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { applyFavorite, FAVORITES_FOLDER, filterByStatus, itemsInLibraryFolder, libraryFolderCounts, nextFavorited, STATUS_FILTERS } from "../src/lib/libraryFilters.js";
import { mergeStudyArticles } from "../src/lib/articleLibrary.js";
import { vocabListMarker } from "../src/lib/vocabListCard.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const requireFromRepo = createRequire(path.join(root, "package.json"));

async function renderJsx(sourceFile, body) {
  const dir = mkdtempSync(path.join(root, "server", ".render-"));
  const outfile = path.join(dir, "bundle.cjs");
  try {
    await build({
      stdin: {
        contents: body,
        resolveDir: root,
        sourcefile: sourceFile,
        loader: "jsx",
      },
      outfile,
      bundle: true,
      format: "cjs",
      platform: "node",
      jsx: "automatic",
      alias: { "@": path.join(root, "src") },
      external: ["react", "react-dom", "react/jsx-runtime"],
    });
    return requireFromRepo(outfile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cardFixture = {
  expression_en: "tenant",
  meaning_zh: "房客，租户",
  mastery_level: "learning",
  type: "phrase",
  stage: 3,
  timestamp: "241.541",
  error_count: 4,
  source_movie_title: "Example",
};

test("vocab list cards render only the mastery marker", async () => {
  const { renderCard } = await renderJsx("vocab-card-render.jsx", `
    import { renderToStaticMarkup } from "react-dom/server";
    import VocabListCard from "./src/components/vocab/VocabListCard.jsx";
    export function renderCard(card) {
      return renderToStaticMarkup(<VocabListCard c={card} />);
    }
  `);
  const html = renderCard(cardFixture);
  assert.match(html, /学习中/);
  assert.match(html, /tenant/);
  assert.match(html, /房客，租户/);
  assert.equal(html.includes("单词"), false);
  assert.equal(html.includes("短语"), false);
  assert.equal(html.includes("轮"), false);
  const text = html.replace(/<[^>]+>/g, " ");
  assert.equal(text.includes("241.541"), false);
  assert.equal(/\d+\.\d{2,}/.test(text), false);
  assert.equal(html.includes("错"), false);
  assert.equal((html.match(/rounded-full/g) || []).length, 1);
  for (const [level, label] of [["new", "未学"], ["familiar", "熟悉"], ["mastered", "已掌握"]]) {
    assert.equal(vocabListMarker({ mastery_level: level }).label, label);
  }
  const cardSource = read("src/components/vocab/VocabListCard.jsx");
  assert.equal(cardSource.includes("typeLabel"), false);
  assert.equal(cardSource.includes("timestamp"), false);
  assert.equal(cardSource.includes("STAGE_LABELS"), false);
});

test("article recommendations share the video status filters and favorite toggle", async () => {
  assert.deepEqual(STATUS_FILTERS.map((filter) => filter.label), ["全部", "未看", "收藏"]);
  const { renderFilters } = await renderJsx("status-filter-render.jsx", `
    import { renderToStaticMarkup } from "react-dom/server";
    import StatusFilterBar from "./src/components/study/StatusFilterBar.jsx";
    export function renderFilters() {
      return renderToStaticMarkup(<StatusFilterBar value="favorites" onChange={() => {}} />);
    }
  `);
  const html = renderFilters();
  for (const label of ["全部", "未看", "收藏"]) assert.match(html, new RegExp(label));
  assert.match(html, /aria-pressed="true"/);

  const articles = [
    { id: "unread", favorited: false, read_at: null },
    { id: "saved", favorited: true, read_at: "2026-10-23T00:00:00.000Z" },
    { id: "read", favorited: false, read_at: "2026-10-22T00:00:00.000Z" },
  ];
  assert.deepEqual(filterByStatus(articles, "all", "read_at").map((item) => item.id), ["unread", "saved", "read"]);
  assert.deepEqual(filterByStatus(articles, "unwatched", "read_at").map((item) => item.id), ["unread"]);
  assert.deepEqual(filterByStatus(articles, "favorites", "read_at").map((item) => item.id), ["saved"]);
  const toggled = applyFavorite(articles, "unread", nextFavorited(articles[0]));
  assert.equal(toggled[0].favorited, true);
  assert.deepEqual(filterByStatus(toggled, "favorites", "read_at").map((item) => item.id), ["unread", "saved"]);
  assert.equal(nextFavorited(toggled[0]), false);

  const articleList = read("src/components/study/DailyArticleList.jsx");
  const recommendations = read("src/pages/DailyRecommendations.jsx");
  assert.match(articleList, /StatusFilterBar/);
  assert.match(articleList, /filterByStatus\(items, filter, "read_at"\)/);
  assert.match(articleList, /setArticleFavorite/);
  assert.match(recommendations, /StatusFilterBar/);
  assert.match(recommendations, /filterByStatus\(items, filter, "watched_at"\)/);
  assert.match(recommendations, /setRecommendationFavorite/);
  assert.match(recommendations, /aria-label=\{item\.favorited \? "取消收藏" : "收藏"\}/);
});

test("study articles merge imports with recommendations and keep a favorites folder", () => {
  const merged = mergeStudyArticles(
    [{ id: "imported", title: "Imported essay", created_at: "2026-10-01T00:00:00.000Z", favorited: false, folder: "" }],
    [{ id: "recommended", title: "Morning read", created_at: "2026-10-23T00:00:00.000Z", rec_date: "2026-10-23", favorited: true, folder: "folder_grammar" }],
  );
  assert.deepEqual(merged.map((item) => item.origin), ["daily", "library"]);
  assert.equal(merged[0].href, "/articles/recommended");
  assert.equal(merged[1].href, "/library-articles/imported");
  assert.equal(merged[0].key, "daily:recommended");

  const folders = [{ id: "folder_grammar", name: "语法" }];
  assert.deepEqual(itemsInLibraryFolder(merged, "all", folders).map((item) => item.id), ["recommended", "imported"]);
  assert.deepEqual(itemsInLibraryFolder(merged, FAVORITES_FOLDER, folders).map((item) => item.id), ["recommended"]);
  assert.deepEqual(itemsInLibraryFolder(merged, "folder_grammar", folders).map((item) => item.id), ["recommended"]);
  assert.deepEqual(itemsInLibraryFolder(merged, "uncategorized", folders).map((item) => item.id), ["imported"]);
  assert.equal(libraryFolderCounts(merged, folders).favorites, 1);
  assert.equal(FAVORITES_FOLDER, "favorites");

  const learn = read("src/components/study/LibraryArticleList.jsx");
  const foldersUi = read("src/components/study/FolderBar.jsx");
  const movieCard = read("src/components/study/LocalMovieCard.jsx");
  const videoLibrary = read("src/components/study/LocalStudyLibrary.jsx");
  assert.match(learn, /listLibraryArticles/);
  assert.match(learn, /listDailyArticles/);
  assert.match(learn, /mergeStudyArticles/);
  assert.match(learn, /FolderBar/);
  assert.match(learn, /setLibraryArticleFavorite/);
  assert.match(learn, /setArticleFavorite/);
  assert.match(learn, /收藏文章/);
  assert.match(foldersUi, /onSelect\("favorites"\)/);
  assert.match(foldersUi, />\s*收藏/);
  assert.match(movieCard, /aria-label=\{meta\.favorited \? "取消收藏" : "收藏"\}/);
  assert.match(videoLibrary, /onToggleFavorite/);
  assert.match(videoLibrary, /FAVORITES_FOLDER/);
  assert.match(read("src/pages/LocalStudy.jsx"), /favorited: next/);
  const migration = read("supabase/migrations/20261023000000_article_folders.sql");
  assert.match(migration, /daily_articles add column if not exists folder/);
  assert.match(migration, /library_articles add column if not exists folder/);
  assert.match(migration, /grant update \(folder\) on public\.daily_articles to authenticated/);
});
