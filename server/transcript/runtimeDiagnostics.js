// Standalone service observability only. Never alters requests, responses or retries.
const log = (fields) => {
  console.log(JSON.stringify({ scope: "transcript-runtime", ...fields }));
  if (process.env.TRANSCRIPT_RUNTIME_SELF_TEST === "1" && fields.roundSequence && globalThis.__transcriptRuntimeHealth) {
    const diagnostics = globalThis.__transcriptRuntimeHealth.diagnostics ||= [];
    if (diagnostics.length < 100) diagnostics.push(fields);
  }
};
log({ event: "startup", node: process.version, platform: process.platform, arch: process.arch });
globalThis.__transcriptRuntimeHealth = {
  node: process.version, platform: process.platform, arch: process.arch,
};

const originalFetch = globalThis.fetch;
let roundSequence = 0;

globalThis.fetch = async function observedFetch(input, options) {
  let context;
  try {
    const url = new URL(typeof input === "string" ? input : input.url || String(input));
    if (url.hostname === "www.youtube.com" && url.pathname === "/youtubei/v1/player") {
      const body = JSON.parse(options?.body || "{}");
      const client = body.context?.client?.clientName;
      if (client === "ANDROID_VR") roundSequence += 1;
      context = { roundSequence, stage: "player", client, videoId: body.videoId };
    } else if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
      context = { roundSequence, stage: "watch", client: "watch-html", videoId: url.searchParams.get("v") };
    } else if ((url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) && url.pathname === "/api/timedtext") {
      context = { roundSequence, stage: "timedtext", format: url.searchParams.get("fmt") };
    }
  } catch { /* Observation must not prevent the original request. */ }

  const startedAt = Date.now();
  let response;
  try {
    response = await originalFetch.call(globalThis, input, options);
  } catch (error) {
    if (context) log({ ...context, errorType: error?.name, errorCode: error?.cause?.code, elapsedMs: Date.now() - startedAt });
    throw error;
  }
  if (context) {
    const metadata = { ...context, httpStatus: response.status, elapsedMs: Date.now() - startedAt };
    // Inspect a clone asynchronously; callers consume the untouched original response.
    const copy = response.clone();
    void copy.text().then((text) => {
      if (context.stage === "watch") {
        log({ ...metadata, captionTracksMarker: text.includes('"captionTracks":['), botChallenge: /Sign in to confirm you(?:'|’)re not a bot/i.test(text) });
      } else {
        let data;
        try { data = JSON.parse(text); }
        catch { log({ ...metadata, parseError: "invalid_json" }); return; }
        if (context.stage === "player") {
          log({ ...metadata, playabilityStatus: data.playabilityStatus?.status, apiErrorStatus: data.error?.status,
            botChallenge: /not a bot/i.test(data.playabilityStatus?.reason || ""),
            captionTracksFound: data.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0 });
        } else {
          log({ ...metadata, eventsCount: Array.isArray(data.events) ? data.events.length : 0 });
        }
      }
    }).catch((error) => log({ ...metadata, observationError: error?.name }));
  }
  return response;
};

// Temporary, one-shot experiment: authenticate against the existing local HTTP route.
// It uses exactly that route's existing retry policy and never changes the extractor.
if (process.env.TRANSCRIPT_RUNTIME_SELF_TEST === "1") {
  globalThis.__transcriptRuntimeHealth.selfTest = { status: "pending" };
  setTimeout(async () => {
    const startedAt = Date.now();
    globalThis.__transcriptRuntimeHealth.selfTest = { status: "running" };
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8787}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TRANSCRIPT_SERVICE_TOKEN}` },
        body: JSON.stringify({ videoId: "LCAY3PGHZyw" }),
      });
      const data = await response.json();
      const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
      const report = { status: response.ok ? "success" : "failed", httpStatus: response.status,
        videoId: "LCAY3PGHZyw", subtitleCount: subtitles.length, attemptCount: data.attemptCount,
        reason: data.reason, elapsedMs: Date.now() - startedAt,
        validTiming: subtitles.length > 0 && subtitles.every(cue => Number.isFinite(cue.start) && cue.duration > 0 && typeof cue.text === "string"),
      };
      globalThis.__transcriptRuntimeHealth.selfTest = report;
      log({ event: "self-test", ...report });
    } catch (error) {
      globalThis.__transcriptRuntimeHealth.selfTest = { status: "failed", errorType: error?.name, elapsedMs: Date.now() - startedAt };
      log({ event: "self-test", ...globalThis.__transcriptRuntimeHealth.selfTest });
    }
  }, 2000).unref();
}
