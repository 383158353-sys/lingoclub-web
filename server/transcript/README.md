# Standalone YouTube Transcript Service

This is a small, provider-neutral Node.js HTTP service around `youtubeTranscriptService.js`. It has no runtime dependency on Base44, Vercel, or Supabase. The extractor module is unchanged.

## Run with Node

Use Node.js 20 or newer. Set a private bearer token and start the existing npm script:

```powershell
$env:TRANSCRIPT_SERVICE_TOKEN = 'set-a-long-random-secret-in-your-host-dashboard'
$env:PORT = '8787'
npm run transcript-service
```

The service listens on `0.0.0.0` by default so container platforms can reach it. Set `HOST=127.0.0.1` for local-only use. Hosting platforms provide `PORT`; local use defaults to `8787`.

## Run as a container

From the repository root:

```sh
docker build -f server/transcript/Dockerfile -t lingoclub-transcript .
docker run --rm -p 8787:8080 \
  -e TRANSCRIPT_SERVICE_TOKEN='set-a-long-random-secret' \
  lingoclub-transcript
```

The container listens on port `8080`. Keep `TRANSCRIPT_SERVICE_TOKEN` in the host's server-side environment settings; never add it to a `VITE_` variable or browser bundle.

## API

`GET /health` returns `{ "ok": true }` without authentication or any YouTube request. It is a process liveness check, not evidence of successful extraction.

`POST /transcript` accepts either `{ "url": "https://youtu.be/VIDEO_ID" }` or `{ "videoId": "VIDEO_ID" }`, with `Authorization: Bearer <token>`. A successful response contains the video metadata and `subtitles: [{ start, duration, text }]`. Requests use the existing extractor and its current bounded retry handling.

The service applies CORS for `https://lingoclub.vercel.app` and `http://localhost:5173` by default. Set `TRANSCRIPT_SERVICE_ALLOWED_ORIGINS` to a comma-separated list if browser clients need different origins. The current LingoClub adapter calls this service server-to-server, so the bearer token remains on the server and browser CORS is not part of that request path.

## LingoClub connection

`server/transcriptResponse.js` converts the service response into the existing frontend `lines` contract, using the shared millisecond timecode formatter. `/api/youtube-transcript` uses this adapter only when `TRANSCRIPT_SERVICE_ENABLED=true`; otherwise it retains the original extractor, even if a URL/token already exists. After a successful remote extraction test, set that flag, `TRANSCRIPT_SERVICE_URL`, and `TRANSCRIPT_SERVICE_TOKEN` in the local test environment and restart Vite. For the independent `subtitle-service/` container, the client token must match that container's `SUBTITLE_SERVICE_KEY`. The API returns separate error codes for service authentication/configuration, network/timeout, YouTube rejection and invalid subtitle data. It does not silently run another extractor after an enabled service fails. Do not enable Production until Preview is verified and accepted.

The repository-root `render.yaml` targets this existing Node Dockerfile, with a platform-generated `TRANSCRIPT_SERVICE_TOKEN`. Use an independent test branch. No local tunnel or local machine is required at runtime. Test `LCAY3PGHZyw` after `/health` succeeds, and measure full request elapsed time before deciding whether synchronous Vercel integration fits the deployed timeout.
