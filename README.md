# LingoClub

LingoClub is a Vite/React learning app with Vercel API routes, Supabase authentication and cloud state, local media support, and review scheduling.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
```

Create the ignored local environment file, fill in the required values described below, then start the dev server:

```powershell
Copy-Item .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:5173/>. The dev server listens on loopback at a fixed port, so this command is the same every time and Vite hot reloads source changes without a push or Vercel deployment.

For signed-in cloud features, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to the same Supabase project used by the app. Local sign-in uses the normal Supabase auth flow; a session from the production website is not shared with localhost.

The Vite server includes local adapters for the repository's Vercel routes:

- `/api/ai-credentials` and `/api/ai` use the local Supabase settings plus server-only `SUPABASE_SERVICE_ROLE_KEY` and `AI_CREDENTIALS_MASTER_KEY`. Sign in locally and configure an AI credential in the app; AI calls are made from the local server to the selected provider.
- `/api/poster-search` and `/api/douban-poster` are handled locally; upstream poster sources still require network access.
- `/api/youtube-transcript` is handled locally. It can call `TRANSCRIPT_SERVICE_URL` (with optional server-only `TRANSCRIPT_SERVICE_TOKEN`) or use the local fallback extractor.
- Other hosted Base44 endpoints remain backed by the configured Base44 app/backend; they are not implemented by the local Vercel-route adapter.

No Vercel local simulator is needed for these five routes. Add server-only values to `.env.local` (never prefix them with `VITE_`):

```dotenv
SUPABASE_SERVICE_ROLE_KEY=
AI_CREDENTIALS_MASTER_KEY=
TRANSCRIPT_SERVICE_URL=
TRANSCRIPT_SERVICE_TOKEN=
```

Restart the dev server after changing environment variables. To test the account's existing encrypted AI credential, `AI_CREDENTIALS_MASTER_KEY` must exactly match the key used when that credential was stored. Vite exposes `VITE_*` values to browser code. Never put service-role keys, master keys, transcript tokens, or provider API keys in browser-visible variables or commit `.env.local`. The example file contains placeholders only.

To run the standalone transcript service separately:

```bash
npm run transcript-service
```

## Checks

```bash
npm test
npm run build
```

## Project areas

- `src/` — React app, study pages, review scheduler, local media, and Supabase client/state code.
- `api/` — Vercel serverless API routes.
- `server/` — shared API handlers, local development API adapter, and standalone transcript service.
- `supabase/` — SQL schema, policies, and migrations.
- `public/` — static assets.

## Environment variables

See `.env.example` for variable names. `VITE_*` values are browser-visible; keep `AI_CREDENTIALS_MASTER_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TRANSCRIPT_SERVICE_TOKEN` server-side only. Do not add Supabase service-role keys or provider API keys to the frontend or repository.

For deployment, use the existing linked Vercel project and its configured environment variables. The production site is `https://lingoclub.vercel.app`.
