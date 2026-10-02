import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const importerPath = new URL("../src/components/study/LocalSeasonImporter.jsx", import.meta.url);
const libraryPath = new URL("../src/components/study/LocalStudyLibrary.jsx", import.meta.url);
const pagePath = new URL("../src/pages/LocalStudy.jsx", import.meta.url);

test("season importer retains visible entry controls and mobile-safe layout contract", async () => {
  const importer = await readFile(importerPath, "utf8");
  assert.match(importer, /useLayoutEffect\(\(\) => \{[\s\S]*?window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)[\s\S]*?document\.documentElement\.scrollLeft = 0[\s\S]*?document\.body\.scrollLeft = 0/);
  assert.match(importer, /min-h-screen w-full max-w-full overflow-x-hidden/);
  assert.match(importer, /导入剧集/);
  assert.match(importer, /选择多个视频/);
  assert.match(importer, /选择多个字幕/);
  assert.match(importer, /grid-cols-1[^\n]*md:grid-cols-\[minmax\(0,1fr\)_5\.5rem_minmax\(0,1fr\)\]/);
  assert.match(importer, /封面暂不可用，仍可继续导入视频和字幕/);
});

test("Local Library season import clears transient overlays before switching view", async () => {
  const library = await readFile(libraryPath, "utf8");
  const page = await readFile(pagePath, "utf8");
  assert.match(library, /const startSeasonImport = \(\) => \{[\s\S]*?setManageMode\(false\)[\s\S]*?setDropDialog\(null\)[\s\S]*?setOrganizeDialog\(false\)[\s\S]*?setAlbumDialog\(false\)[\s\S]*?onImportSeason\?\.\(\)/);
  assert.match(library, /onClick=\{startSeasonImport\}/);
  assert.match(page, /importMode === "season"[\s\S]*?<LocalSeasonImporter/);
});
