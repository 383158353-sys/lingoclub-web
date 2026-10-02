# LingoClub

LingoClub is a Vite/React learning app with Vercel API routes, Supabase authentication and cloud state, local media support, and review scheduling.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill in the needed values in `.env.local` before using authenticated cloud features or server-side transcript APIs. Per-account AI APIs are encrypted with `AI_CREDENTIALS_MASTER_KEY` and stored server-side; also configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in server environments. The example file contains placeholders only. Never commit `.env.local` or production credentials.

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

See `.env.example` for the variable names used by the local app. `VITE_*` values are browser-visible; keep `AI_CREDENTIALS_MASTER_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `TRANSCRIPT_SERVICE_TOKEN` in server-side environment configuration only. Do not add Supabase service-role keys or provider API keys to the frontend or repository.

For deployment, use the existing linked Vercel project and its configured environment variables. The production site is `https://lingoclub.vercel.app`.
