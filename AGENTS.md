# AGENTS.md

## Project Context

This is a Base44 app repository. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup, environment variables, and publish workflow.

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md

If your agent supports Agent Skills, install or update Base44 skills before Base44-specific work:

```bash
npx skills add base44/skills
```

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: frontend Base44 SDK client.
- `vite.config.js`: Vite config and Base44 Vite plugin setup.
- `.env.local`: local-only environment values; never commit secrets.

## Working Notes

- Use `base44 dev` as the default local development command when you need the local Base44 backend. It can run the backend and frontend together.
- When docs or code mention the frontend being started automatically, that usually means the Base44 project config includes `site.serveCommand`, for example `"serveCommand": "npm run dev"` in `base44/config.jsonc`.
- Use `npm run dev` only for frontend-only work against the hosted Base44 backend.
- Prefer the existing Base44 CLI workflow over adding new npm scripts for Base44-specific tasks.
- Reuse the existing SDK client and Vite plugin patterns before adding new Base44 integration paths.
- Run the relevant checks from `package.json` before finishing code changes.

## Required Delivery Workflow

Use `F:\base44-backup\lingoclub-release` as the fixed production development directory. Never treat `local-agent` as the production development directory.

After every code change:

1. Run the tests or checks directly related to the change first.
2. Run the complete `npm test` suite.
3. Run `npm run build`.
4. Only after the relevant checks, complete test suite, and build all pass, run `git add` and create a commit.
5. Before pushing a feature change, start the local development test environment and let the user verify the change at its fixed test URL.
6. Do not push feature changes to `main` or trigger Production deployment until the user explicitly accepts the test result.
7. After acceptance, push to the GitHub remote for the current production repository. When the target branch is `main`, confirm the push and inspect the resulting Vercel automatic Production deployment.
8. If any test or build fails, do not push `main`; fix the failure and rerun the required checks first.

## Fixed Local Test Environment

- Start the fixed-port Vite server with `npm run dev:test` or `start-lingoclub-dev.ps1`.
- Computer URL: `http://127.0.0.1:5173/`.
- Vite binds to `0.0.0.0:5173`, port `5173`, with `strictPort: true`; LAN devices use the computer's current Wi-Fi IPv4 address.
- The stable public test URL is `https://<LINGOCLUB_DEV_HOST>` after the owner configures a Cloudflare named tunnel and a domain/zone they control. Never substitute a random Quick Tunnel URL as the fixed test URL.
- The public hostname is not yet configured in this checkout. Until Cloudflare tunnel credentials and an owned hostname exist, do not claim iPhone access outside the LAN is ready.
- `.env.local` is ignored by Git. Keep Supabase client settings there, and keep service-role/master/provider secrets server-side only.
- Development builds show a `DEV` badge. The bookmarklet generated on a development origin must point to that origin; Production bookmarklets remain pointed at Production.

## Regression-First Rule

When a user reports behavior that used to work but now fails:

1. Inspect Git history before editing code.
2. Identify the latest commit/version where the behavior was confirmed working.
3. Diff that version against current `main` and classify the cause as a regression, an older design flaw, or an external service change.
4. Prefer the smallest fix to the regressed existing path; do not rewrite a working module.
5. Do not add a shadow implementation alongside existing behavior.
6. Search for existing repositories, services, caches, helpers, and API routes before adding or replacing any of them.
7. Reuse existing project logic or fix its API contract; keep a single source of truth.
8. Remove duplicate paths if a replacement is necessary.
9. Passing unit tests is not enough: verify the real browser/user flow before claiming the regression is fixed.

The final report must include these fields:

- 修改内容
- npm test
- npm run build
- commit SHA
- GitHub push
- Vercel Production
