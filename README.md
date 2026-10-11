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

## 每日推荐导入接口（今日推荐）

推荐助手每天把推荐视频 POST 到 `/api/recommendations/import`，App 的「今日推荐」页（`/recommendations`）按日期展示，点开进入 `/quick-study` 精读。

服务端环境变量（只放 Vercel，不要用 `VITE_` 前缀）：

- `RECOMMENDATIONS_IMPORT_TOKEN`：导入口令，调用方放在 `Authorization: Bearer <token>`。
- `RECOMMENDATIONS_IMPORT_USER_ID`：推荐写入哪个用户（Supabase Auth 用户 UUID）。
- `SUPABASE_SERVICE_ROLE_KEY` 与 `VITE_SUPABASE_URL`：与 `/api/ai-credentials` 共用。

数据表由 `supabase/migrations/20261011000000_daily_recommendations.sql` 创建。浏览器只能读取自己的推荐、修改 `watched_at` / `favorited`，不能插入。

请求体：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | 推荐日期（必填） |
| `source` | `digest` \| `morning_read` | 默认来源，单条可覆盖 |
| `items` | 数组，1–50 条 | 推荐列表 |
| `items[].url` | string | YouTube 链接（watch / youtu.be / shorts / live 均可）；与 `youtube_id` 至少填一个 |
| `items[].youtube_id` | string | 11 位视频 ID；缺省时从 `url` 解析 |
| `items[].title` | string | 标题（必填） |
| `items[].duration_seconds` | integer | 时长（秒） |
| `items[].level` | string | 难度，如 `B1` |
| `items[].tags` | string[] | 标签，最多 20 个 |
| `items[].summary_zh` | string | 中文要点 |
| `items[].why_relevant` | string | 为什么跟你有关 |
| `items[].source` | `digest` \| `morning_read` | 单条来源 |

同一用户、同一日期、同一视频重复导入只会更新内容，不会重置“已看/收藏”。

```bash
curl -X POST https://<your-app>/api/recommendations/import \
  -H "Authorization: Bearer $RECOMMENDATIONS_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-10-12",
    "source": "morning_read",
    "items": [
      {
        "url": "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
        "title": "Steve Jobs 2005 Stanford Commencement Address",
        "duration_seconds": 904,
        "level": "B2",
        "tags": ["演讲", "人生"],
        "summary_zh": "三个故事：连点成线、热爱与失去、死亡。",
        "why_relevant": "语速适中、发音清晰，适合跟读练习。"
      }
    ]
  }'
```

响应：`{"ok":true,"date":"2026-10-12","received":1,"inserted":1,"updated":0,"rejected":[]}`。无效条目会出现在 `rejected`（含 `index` 和原因），其余有效条目照常写入；口令错误返回 401，未配置返回 503。

## YouTube 字幕提取

`/api/youtube-transcript` 依次尝试：

1. **Supadata**（配置了 `SUPADATA_API_KEY` 时）：由 Supadata 的服务器读取 YouTube 已有字幕（人工或自动生成），不受 Vercel 数据中心 IP 被 YouTube 拦截的影响。使用 `mode=native`，每次 1 credit，不会触发按分钟计费的 AI 转写。免费版每月 100 credits（1 次/秒），Basic 每年 $60，每月 300 credits。额度用完或 Key 无效时自动回退到下面的方式。
2. 独立字幕服务（`TRANSCRIPT_SERVICE_URL`，见 `server/transcript/`）。
3. 内置多客户端 innertube 提取。本地或住宅网络下可用，但在 Vercel 上常被 YouTube 要求“机器人验证”。

同一视频提取成功后，服务端实例内存和浏览器 localStorage 都会缓存，重复打开不会再消耗额度。
