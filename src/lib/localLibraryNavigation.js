const KEY = "lingoclub:local-library-navigation:v1";

export function normalizeLocalLibraryView(view = {}) {
  return { tab: view.tab === "films" ? "films" : "videos", activeFolder: view.activeFolder || "all", activeSeasonId: view.activeSeasonId || null };
}

export function parentLocalLibraryView(view = {}) {
  const current = normalizeLocalLibraryView(view);
  if (current.activeSeasonId) return { tab: "films", activeFolder: "all", activeSeasonId: null };
  if (current.activeFolder !== "all") return { tab: current.tab, activeFolder: "all", activeSeasonId: null };
  return null;
}

export function createLocalLibraryHistoryEntry(currentState, targetView) {
  return {
    view: normalizeLocalLibraryView(targetView),
    parent: currentState?.lingoclubLocalLibraryView?.view
      ? normalizeLocalLibraryView(currentState.lingoclubLocalLibraryView.view)
      : null,
  };
}

export function readLocalLibraryView() {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return value && typeof value === "object" ? value : { tab: "videos", activeFolder: "all", activeSeasonId: null };
  } catch { return { tab: "videos", activeFolder: "all", activeSeasonId: null }; }
}

export function saveLocalLibraryView(view) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ tab: view.tab || "videos", activeFolder: view.activeFolder || "all", activeSeasonId: view.activeSeasonId || null })); } catch { /* route can still open without restoration */ }
}

export function pushLocalLibraryView(view) {
  const entry = createLocalLibraryHistoryEntry(window.history.state, view);
  const normalized = entry.view;
  saveLocalLibraryView(normalized);
  try {
    window.history.pushState({ ...(window.history.state || {}), lingoclubLocalLibraryView: entry }, "", window.location.href);
  } catch { /* page-level back still has the saved parent view as a fallback */ }
  return normalized;
}

export function replaceLocalLibraryView(view) {
  const normalized = normalizeLocalLibraryView(view);
  saveLocalLibraryView(normalized);
  try {
    window.history.replaceState({ ...(window.history.state || {}), lingoclubLocalLibraryView: { view: normalized, parent: null } }, "", window.location.href);
  } catch { /* session view still restores after the local player closes */ }
  return normalized;
}
