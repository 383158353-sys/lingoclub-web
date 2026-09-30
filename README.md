# LingoClub

LingoClub is a Vite/React learning app with Vercel API routes, Supabase authentication and cloud state, local media support, and review scheduling.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Fill in the needed values in `.env.local` before using authenticated cloud features or server-side AI/transcript APIs. The example file contains placeholders only. Never commit `.env.local` or production credentials.

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

See `.env.example` for the variable names used by the local app. `VITE_*` values are browser-visible; keep private keys such as `AI_API_KEY` and `TRANSCRIPT_SERVICE_TOKEN` in server-side environment configuration only. Do not add Supabase `service_role` keys to the frontend or repository.

For deployment, use the existing linked Vercel project and its configured environment variables. The production site is `https://lingoclub.vercel.app`.
