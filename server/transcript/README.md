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

`POST /transcript` accepts either `{ "url": "https://youtu.be/VIDEO_ID" }` or `{ "videoId": "VIDEO_ID" }`, with `Authorization: Bearer <token>`. A successful response contains the video metadata and `subtitles: [{ start, duration, text }]`. Requests use the existing extractor and its current bounded retry handling.

The service applies CORS for `https://lingoclub.vercel.app` and `http://localhost:5173` by default. Set `TRANSCRIPT_SERVICE_ALLOWED_ORIGINS` to a comma-separated list if browser clients need different origins. The current LingoClub adapter calls this service server-to-server, so the bearer token remains on the server and browser CORS is not part of that request path.

## LingoClub connection

The Vercel `/api/youtube-transcript` adapter checks its 30-day process cache first, then uses `TRANSCRIPT_SERVICE_URL` when configured with `TRANSCRIPT_SERVICE_TOKEN` held server-side. If that service is missing or fails, the adapter falls back to the built-in multi-client YouTube extractor with bounded retries. If server extraction still fails, the browser client may try its historical proxy fallback. Successful results are cached on the client for 30 days as well. Test new service credentials in Preview before changing Production configuration.
