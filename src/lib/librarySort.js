// Order of videos in 我的视频.
// - Videos the user has manually reordered (numeric sort_order) keep that order.
// - Everything else (new imports, re-imports) comes first, newest import first.
//   A re-import clears sort_order and refreshes imported_at so it jumps to the top.

function hasManualOrder(item) {
  const value = item?.sort_order;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function importTime(item) {
  const time = Date.parse(item?.imported_at || item?.created_date || "");
  return Number.isFinite(time) ? time : 0;
}

export function compareLibraryItems(a, b) {
  const aOrdered = hasManualOrder(a);
  const bOrdered = hasManualOrder(b);
  if (aOrdered && bOrdered) {
    const diff = Number(a.sort_order) - Number(b.sort_order);
    if (diff) return diff;
  } else if (aOrdered !== bOrdered) {
    return aOrdered ? 1 : -1;
  }
  return importTime(b) - importTime(a);
}

export function sortLibraryItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort(compareLibraryItems);
}
