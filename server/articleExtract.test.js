import assert from "node:assert/strict";
import test from "node:test";
import { extractArticleFromHtml, fetchArticle, handleArticleExtract, validateArticleFetchUrl } from "./articleExtract.js";

const html = `<!doctype html><html lang="en"><head><title>A public English article</title>
  <meta name="author" content="Jane Writer"><meta property="og:site_name" content="Example News"></head>
  <body><header>Navigation</header><article><h1>A public English article</h1>
  <p>First paragraph explains the central story in enough detail for readers to understand what happened today.</p>
  <p>Second paragraph gives further context and keeps the article useful for English reading practice.</p>
  <p>Third paragraph describes the outcome and what the people involved plan to do next.</p>
  </article><footer>Cookies and privacy</footer></body></html>`;
const publicDns = async () => [{ address: "93.184.215.14" }];

test("Readability extracts title, paragraphs, author and outlet from HTML", () => {
  const article = extractArticleFromHtml(html, "https://example.com/story");
  assert.match(article.title, /A public English article/);
  assert.match(article.body_en, /First paragraph[^]*\n\nSecond paragraph/);
  assert.doesNotMatch(article.body_en, /Cookies and privacy/);
  assert.equal(article.author, "Jane Writer");
  assert.equal(article.outlet, "Example News");
});

test("article fetch rejects local addresses, private DNS and credential URLs", async () => {
  for (const url of ["http://localhost/story", "http://127.0.0.1/story", "http://10.1.2.3/story", "http://169.254.169.254/latest/meta-data", "http://[::1]/story", "file:///secret", "https://user:pass@example.com/story"]) {
    await assert.rejects(validateArticleFetchUrl(url, publicDns), (error) => error.status === 400, url);
  }
  await assert.rejects(validateArticleFetchUrl("https://public.example/story", async () => [{ address: "192.168.1.9" }]), (error) => error.status === 400);
});

test("article fetch validates redirects and returns readable HTML", async () => {
  const urls = [];
  const article = await fetchArticle("https://example.com/old", {
    resolve: publicDns,
    fetchImpl: async (url) => {
      urls.push(url.href);
      return url.pathname === "/old"
        ? new Response(null, { status: 302, headers: { location: "/story" } })
        : new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  assert.deepEqual(urls, ["https://example.com/old", "https://example.com/story"]);
  assert.equal(article.source_url, "https://example.com/story");
  assert.match(article.body_en, /Third paragraph/);
  await assert.rejects(fetchArticle("https://example.com/old", {
    resolve: publicDns,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  }), (error) => error.status === 400);
});

test("extract API requires login and returns a Chinese fallback error without clearing the form", async () => {
  const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } });
  const unauthorized = response();
  await handleArticleExtract({ method: "POST", headers: {} }, unauthorized, { url: "https://example.com/story" }, {}, { authenticate: async () => { throw Object.assign(new Error("请先登录"), { status: 401 }); } });
  assert.equal(unauthorized.statusCode, 401);
  const failed = response();
  await handleArticleExtract({ method: "POST" }, failed, { url: "https://example.com/story" }, {}, {
    authenticate: async () => {}, extract: async () => { throw Object.assign(new Error("无法自动提取，请粘贴正文"), { status: 422 }); },
  });
  assert.equal(failed.statusCode, 422);
  assert.match(failed.body.error, /请粘贴正文/);
});
