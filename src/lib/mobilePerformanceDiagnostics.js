const MOBILE_QUERY = "(max-width: 767px)";

export function summarizeMobilePerformance({ navigation, resources, userStateRequests = [], firstUsableMs = null }) {
  const entries = resources || [];
  const beforeUsable = firstUsableMs == null ? [] : entries.filter((entry) => entry.responseEnd <= firstUsableMs);
  const scripts = beforeUsable.filter((entry) => entry.initiatorType === "script" || /\.m?js(?:[?#]|$)/i.test(entry.name || ""));
  const images = entries.filter((entry) => entry.initiatorType === "img" || /\.(?:png|jpe?g|webp|avif|gif|svg)(?:[?#]|$)/i.test(entry.name || ""));
  const bytes = (items) => items.reduce((total, entry) => total + (entry.transferSize || entry.encodedBodySize || 0), 0);
  const userStates = userStateRequests || [];
  return {
    domContentLoadedMs: navigation?.domContentLoadedEventEnd || null,
    firstUsableMs,
    jsTransferredBeforeUsableBytes: bytes(scripts),
    userState: {
      count: userStates.length,
      bytes: userStates.reduce((total, item) => total + (item.requestBytes || 0) + (item.responseBytes || 0), 0),
      totalLatencyMs: userStates.reduce((total, item) => total + (item.durationMs || 0), 0),
    },
    imageRequests: images.map((entry) => ({ durationMs: Math.round(entry.duration), bytes: entry.transferSize || entry.encodedBodySize || 0 })),
    requestsBeforeUsable: beforeUsable.length,
  };
}

export function startMobilePerformanceDiagnostics() {
  if (typeof window === "undefined" || typeof performance === "undefined" || !window.matchMedia(MOBILE_QUERY).matches) return;
  if (window.__LINGOCLUB_MOBILE_PERFORMANCE_STARTED__) return;
  window.__LINGOCLUB_MOBILE_PERFORMANCE_STARTED__ = true;

  let firstUsableMs = null;
  let observer;
  let finalTimer;
  const root = document.getElementById("root");
  const finalize = () => {
    observer?.disconnect();
    const navigation = performance.getEntriesByType("navigation")[0];
    const report = summarizeMobilePerformance({
      navigation,
      resources: performance.getEntriesByType("resource"),
      userStateRequests: window.__LINGOCLUB_USER_STATE_REQUESTS__ || [],
      firstUsableMs,
    });
    window.__LINGOCLUB_MOBILE_PERFORMANCE__ = report;
    console.info("[LingoClub mobile performance]", JSON.stringify(report));
  };
  const detectUsable = () => {
    if (firstUsableMs !== null || !root) return;
    const actionable = root.querySelector("a[href],button:not(:disabled),input:not(:disabled),[role='button']");
    if (!actionable || actionable.getClientRects().length === 0) return;
    firstUsableMs = Math.round(performance.now());
    window.__LINGOCLUB_MOBILE_PERFORMANCE_FIRST_USABLE_MS__ = firstUsableMs;
    finalTimer = window.setTimeout(finalize, 2000);
  };

  observer = new MutationObserver(detectUsable);
  if (root) observer.observe(root, { childList: true, subtree: true, attributes: true });
  if (document.readyState !== "loading") detectUsable();
  else document.addEventListener("DOMContentLoaded", detectUsable, { once: true });
  window.addEventListener("pagehide", () => {
    if (firstUsableMs !== null) {
      window.clearTimeout(finalTimer);
      finalize();
    } else observer?.disconnect();
  }, { once: true });
}
