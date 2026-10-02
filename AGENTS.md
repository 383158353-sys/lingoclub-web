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
5. Push to the GitHub remote for the current production repository by default.
6. When the target branch is `main`, confirm that the push succeeded and inspect the resulting Vercel automatic Production deployment.
7. If any test or build fails, do not push `main`; fix the failure and rerun the required checks first.

The final report must include these fields:

- 修改内容
- npm test
- npm run build
- commit SHA
- GitHub push
- Vercel Production
