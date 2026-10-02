import test from "node:test";
import assert from "node:assert/strict";
import { createLocalLibraryHistoryEntry, normalizeLocalLibraryView, parentLocalLibraryView } from "../src/lib/localLibraryNavigation.js";

test("Local Library Back follows one level: Episode -> Season -> root", () => {
  const root = normalizeLocalLibraryView({ tab: "films" });
  const season = normalizeLocalLibraryView({ tab: "films", activeSeasonId: "hacks-s2" });
  assert.deepEqual(parentLocalLibraryView(season), root);
  assert.equal(parentLocalLibraryView(root), null);
});

test("folder navigation preserves the selected videos tab as its parent", () => {
  const root = { lingoclubLocalLibraryView: { view: normalizeLocalLibraryView({ tab: "videos" }), parent: null } };
  const folder = createLocalLibraryHistoryEntry(root, { tab: "videos", activeFolder: "favorites" });
  assert.deepEqual(folder.parent, normalizeLocalLibraryView({ tab: "videos" }));
  assert.deepEqual(parentLocalLibraryView(folder.view), normalizeLocalLibraryView({ tab: "videos" }));
});

test("a directly opened deep link has a safe parent fallback and no false history parent", () => {
  const entry = createLocalLibraryHistoryEntry({}, { tab: "films", activeSeasonId: "hacks-s2" });
  assert.equal(entry.parent, null);
  assert.deepEqual(parentLocalLibraryView(entry.view), normalizeLocalLibraryView({ tab: "films" }));
});
