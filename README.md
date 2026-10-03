# LingoClub

LingoClub is a Vite/React learning app with Vercel API routes, Supabase authentication and cloud state, local media support, and review scheduling.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
```

Create the ignored local environment file, fill in the required values described below, then start the fixed-port LAN dev server:

```powershell
Copy-Item .env.example .env.local
npm run dev:test
```

Computer: <http://127.0.0.1:5173/>. On the current iPhone hotspot, the phone can reach the computer at <http://172.20.10.4:5173/>. Vite binds to `0.0.0.0:5173` with strict port selection and HMR. This LAN address is currently DHCP-assigned; the fixed public hostname remains pending until a Cloudflare-managed domain/zone is available.

The fixed public test URL is pending Cloudflare setup. Do not use a Quick Tunnel because its URL is temporary. A Cloudflare named tunnel needs `cloudflared`, a Cloudflare account with DNS permission, and a domain/zone managed by that account. Once configured, set the hostname (without scheme) as `LINGOCLUB_DEV_HOST` in `.env.local`; Vite will allow only that hostname and use WSS HMR through the tunnel. No Cloudflare tunnel credentials belong in this repository.

Run `.\start-lingoclub-dev.ps1` from PowerShell to start Vite and, when the named tunnel configuration is present, the tunnel. Add `-InstallStartup` only after the tunnel is configured to register this script for the current Windows user's login. Logs are written under ignored `logs/`.

Development builds show a `DEV` badge. The bookmarklet generated from a development page points back to that same origin; production continues using the production origin. Do not push a feature change to `main` until it has been checked at the test URL and you explicitly accept it.

For signed-in cloud features, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to the same Supabase project used by the app. Local sign-in uses the normal Supabase auth flow; a session from the production website is not shared with localhost.

The Vite server includes local adapters for the repository's Vercel routes:

- In development only, `GET /api/ai-credentials` and `POST /api/ai` are proxied server-to-server to `https://lingoclub.vercel.app`. This lets a local sign-in use the existing Production credential and Production-only decryption key to test models. Credential create/update/delete requests are not proxied, so local credential-management actions cannot mutate Production. No Production master key is needed in `.env.local` for read-only credential lookup and AI requests. The rest of the local API adapter continues to use local configuration.
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
