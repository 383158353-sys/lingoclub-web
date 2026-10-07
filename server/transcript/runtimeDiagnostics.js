// Standalone service observability only. Never alters requests, responses or retries.
const log = (fields) => console.log(JSON.stringify({ scope: "transcript-runtime", ...fields }));
log({ event: "startup", node: process.version, platform: process.platform, arch: process.arch });

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
