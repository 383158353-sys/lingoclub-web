import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMobilePerformance } from "../src/lib/mobilePerformanceDiagnostics.js";

test("mobile performance summary records startup, user_state, image, and pre-usable metrics", () => {
  const summary = summarizeMobilePerformance({
    navigation: { domContentLoadedEventEnd: 410 },
    firstUsableMs: 620,
    resources: [
      { name: "/assets/app.js", initiatorType: "script", responseEnd: 500, transferSize: 1200, duration: 80 },
      { name: "https://cdn.example/poster.webp", initiatorType: "img", responseEnd: 570, transferSize: 800, duration: 160 },
      { name: "/late.js", initiatorType: "script", responseEnd: 900, transferSize: 1000, duration: 100 },
    ],
    userStateRequests: [{ requestBytes: 30, responseBytes: 200, durationMs: 450 }],
  });
  assert.equal(summary.domContentLoadedMs, 410);
  assert.equal(summary.firstUsableMs, 620);
  assert.equal(summary.jsTransferredBeforeUsableBytes, 1200);
  assert.deepEqual(summary.userState, { count: 1, bytes: 230, totalLatencyMs: 450 });
  assert.equal(summary.imageRequests.length, 1);
  assert.equal(summary.imageRequests[0].durationMs, 160);
  assert.equal(summary.requestsBeforeUsable, 2);
});
