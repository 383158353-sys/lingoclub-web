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

响应：`{"ok":true,"date":"2026-10-12","received":1,"inserted":1,"updated":0,"rejected":[],"items":[{"youtube_id":"UF8uR6Z6KLc","embeddable":true}]}`。无效条目会出现在 `rejected`（含 `index` 和原因），其余有效条目照常写入；口令错误返回 401，未配置返回 503。

## 每日精读短文导入接口

`POST /api/articles/import` 将调用方提供的英文摘录和精读解析写入独立的 `daily_articles` 表。
复用 `RECOMMENDATIONS_IMPORT_TOKEN`、`RECOMMENDATIONS_IMPORT_USER_ID`、`SUPABASE_SERVICE_ROLE_KEY` 和 Supabase URL；不增加口令，不抓取出处网页，不调用 AI。

上线前按顺序应用：

- `supabase/migrations/20261014000000_daily_articles.sql`
- `supabase/migrations/20261014010000_daily_articles_service_role_grant.sql`

浏览器只能读自己的文章，修改 `read_at`、`favorited`、`folder`、`updated_at`。同一用户、日期、出处 URL 重导只更新内容，保留已读、收藏和文件夹。学习页「收藏」文件夹不另存一行，它只列出 `favorited` 为真的文章。
每次 1–10 篇；`title` / `body_en` / http(s) `source_url` 必填。长度上限：标题 300、作者/出处 120、难度 32、简介 4000、正文 50000、链接 2048；标签最多 20 个（每个 40 字），解析 JSON 最多 200000 字符。

```bash
curl -X POST http://127.0.0.1:5173/api/articles/import \
  -H "Authorization: Bearer $RECOMMENDATIONS_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-10-14",
    "source": "morning_read",
    "items": [{
      "source_url": "https://example.com/morning-read",
      "title": "Learning through discomfort",
      "author": "Example author",
      "outlet": "Example",
      "level": "B2",
      "tags": ["学习", "职场"],
      "summary_zh": "一篇用于验收的晨读示例。",
      "body_en": "Learning something new can feel uncomfortable.\n\nWe can push through the discomfort and keep practising.",
      "analysis": {
        "paragraph_summaries": [{"index": 1, "zh": "学习新事物可能让人不适。"}, {"index": 2, "zh": "克服不适并继续练习。"}],
        "key_vocab": [{"en": "uncomfortable", "zh": "不舒服的", "note": "形容词"}],
        "long_sentences": [{"en": "We can push through the discomfort and keep practising.", "structure": "can 后接并列谓语", "zh": "我们可以克服不适并继续练习。"}],
        "ielts_expressions": [{"en": "push through the discomfort", "usage": "克服不适（口语/写作）"}]
      }
    }]
  }'
```

解析中的段落序号 `index` 从 1 开始；词汇用 `en/zh/note`，长难句用 `en/structure/zh`，雅思表达用 `en/usage`。缺省解析存 `{}`，前端缺字段显示空区块，多余字段不影响阅读。
响应：`{ok,date,received,inserted,updated,rejected:[{index,error}]}`；部分无效条目跳过，全部无效返回 400，鉴权失败 401，配置缺失 503。

手动验收：在隔离测试 Supabase 应用迁移并配置本地环境，运行 `npm run dev:test`，导入示例后打开「今日推荐 → 文章」，阅读、划词收藏、收藏长难句和雅思表达；在语料库点击来源应回到 `/articles/:id`。重导后已读/收藏不应重置。不要为验收修改 Production 数据。

## 学习文章手动导入

学习页 `/local-study?tab=articles` 同时列出每日推荐（`daily_articles`）和手动导入（`library_articles`）。文件夹复用视频库的 `FolderBar` 与 `localFolders`（`tab_type: "articles"`），文章上的 `folder` 字段记下归类。`收藏` 是独立文件夹，视频库和文章库都按 `favorited` 筛选，不把条目标出原来的文件夹。
发布前按顺序应用 `supabase/migrations/20261015000000_library_articles.sql` 和 `supabase/migrations/20261023000000_article_folders.sql`；authenticated 只能 CRUD 自己的导入文章，每日推荐文章只能改阅读状态、收藏和文件夹，匿名无权限。
底栏「导入 → 精读文章」可粘贴公开出处 URL 后点击「提取正文」：登录态 `/api/articles/extract` 在服务端读取网页并回填标题、英文正文、作者和出处。付费墙、反爬及纯客户端渲染页面可能提取失败，此时手动填写标题和正文仍可导入。精读解析 JSON 保持选填，不会自动生成；不使用每日推荐自动化导入口令。
阅读路由 `/library-articles/:id` 复用精读阅读页，收藏来源类型 `library_article` 回跳该路由。

手机验收：学习页切换影视/文章；导入两段正文；打开阅读点词或划句收藏；语料库返回文章；底栏「我的」管理显示名。

## YouTube 字幕提取

`/api/youtube-transcript` 依次尝试：

1. **Supadata**（配置了 `SUPADATA_API_KEY` 时）：由 Supadata 的服务器读取 YouTube 已有字幕（人工或自动生成），不受 Vercel 数据中心 IP 被 YouTube 拦截的影响。使用 `mode=native`，每次 1 credit，不会触发按分钟计费的 AI 转写。免费版每月 100 credits（1 次/秒），Basic 每年 $60，每月 300 credits。额度用完或 Key 无效时自动回退到下面的方式。
2. 独立字幕服务（`TRANSCRIPT_SERVICE_URL`，见 `server/transcript/`）。
3. 内置多客户端 innertube 提取。本地或住宅网络下可用，但在 Vercel 上常被 YouTube 要求“机器人验证”。

同一视频提取成功后，服务端实例内存和浏览器 localStorage 都会缓存，重复打开不会再消耗额度。

单词详情里的「预览原句」在查到原句时间点之后才挂上 YouTube iframe，此时原来的点击已经不是用户手势。预览因此用静音、内联、`autoplay=1`、`start`（秒）和 `controls=0` 直接循环当前句：不显示「播放原句」，也不把 YouTube 控制条和正中的大红播放钮留给第二次点击。打开预览的那一下会先做一次静音媒体解锁。开始播放后再尝试取消静音；若浏览器拒绝有声播放，预览继续静音循环，而不是盖一层播放按钮。循环的是当前句的起止时间（播到句末 seek 回句首）。没有使用 YouTube 的 `loop=1`，因为那会把整段视频重播，并且必须同时设置 `playlist` 为同一个视频 ID。`controls=0` 只用于这条原句预览。精读、本地文件和文章点播没有这条请求，仍保持 `autoplay=0` 和播放器自己的控件。参数与 [YouTube IFrame Player API 播放器参数](https://developers.google.com/youtube/player_parameters) 和 [WebKit 媒体策略](https://webkit.org/blog/6784/) 一致，写法参考 MIT 许可的 [@u-wave/react-youtube](https://github.com/u-wave/react-youtube)（`autoplay`、`startSeconds`、`muted`、`playsInline`、`controls`）。

斩只出现在单词详情底栏（「关闭」旁）和复习底栏（「继续复习」旁，以及测验卡底栏）。语料库和错词列表的卡片行上没有斩，也没有取消斩。点斩仍写入已有的已掌握状态，复习队列、到期列表和首页待复习不再包含该词；取消斩只在详情和复习底栏。

语料库和错词列表的卡片底部只保留掌握状态（未学、学习中、熟悉、已掌握）。类型「单词 / 短语」、轮次和时间序号不显示。这里没有可复用的开源组件，记为 N/A。

文章与视频对齐复用了现有实现，没有新增依赖：推荐页的「全部 / 未看 / 收藏」来自 `src/lib/libraryFilters.js` 和 `StatusFilterBar`；收藏写入已有的 `favorited` 字段；学习页文件夹继续用 `FolderBar` 的原生拖放。项目里已有 MIT 许可的 [`@hello-pangea/dnd`](https://github.com/hello-pangea/dnd)（react-beautiful-dnd 的维护分支），这次没有改用它，避免和现有文件夹拖放各做一套。

复习选项先用本机词库和固定干扰项立刻凑满四选一，下一张的相近干扰项在后台预取；网络慢或失败时当前题不等待。

### 给推荐助手的提示：优先推荐可嵌入的视频

部分视频的作者关闭了“允许嵌入”。这类视频在 App 里不能直接播放，只能点「在 YouTube 上观看」跳出，但字幕精读仍可用。判断方法：`https://www.youtube.com/oembed?format=json&url=<视频链接>` 返回 401 或 403 就是不可嵌入。请优先推荐可嵌入的视频。

导入接口的响应里，每条推荐都会带上这个判断结果：`items: [{ "youtube_id": "...", "embeddable": true | false | null }]`。`false` 表示不可嵌入，`null` 表示暂时无法判断。不可嵌入的视频仍然会写入，不会因此被拒绝。
