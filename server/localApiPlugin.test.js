import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { localApiPlugin } from "./localApiPlugin.js";

function installMiddleware(plugin, hook = "configureServer") {
  let middleware;
  plugin[hook]({ middlewares: { use(fn) { middleware = fn; } } });
  return middleware;
}

function request(method, url, body = "", authorization = "") {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(authorization ? { authorization } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
    accept: "application/json",
  };
  return req;
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
}

test("development AI proxy forwards only signed-in credential reads and AI calls to Production", async () => {
  const calls = [];
  const logs = [];
  const previousInfo = console.info;
  console.info = (...args) => logs.push(args);
  try {
    const middleware = installMiddleware(localApiPlugin({}, {
      productionAiApiTarget: "https://lingoclub.vercel.app",
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(JSON.stringify({
          diagnostic: { provider: "gemini", model: "test-model", upstreamStatus: 200 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }));

    const credentialResponse = response();
    await middleware(request("GET", "/api/ai-credentials", "", "Bearer test-session-token"), credentialResponse, () => {});
    const aiResponse = response();
    const aiBody = JSON.stringify({ credential_id: "credential-id", task: "ai_connection_test" });
    await middleware(request("POST", "/api/ai", aiBody, "Bearer test-session-token"), aiResponse, () => {});

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://lingoclub.vercel.app/api/ai-credentials");
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.headers.authorization, "Bearer test-session-token");
    assert.equal(calls[1].url, "https://lingoclub.vercel.app/api/ai");
    assert.equal(calls[1].options.method, "POST");
    assert.equal(calls[1].options.headers.authorization, "Bearer test-session-token");
    assert.equal(Buffer.from(calls[1].options.body).toString(), aiBody);
    assert.equal(credentialResponse.statusCode, 200);
    assert.equal(aiResponse.statusCode, 200);
    assert.equal(credentialResponse.headers["cache-control"], "no-store");
    assert.equal(JSON.stringify(logs).includes("test-session-token"), false);
  } finally {
    console.info = previousInfo;
  }
});

test("development AI proxy does not forward credential mutations to Production", async () => {
  let proxyCalls = 0;
  const middleware = installMiddleware(localApiPlugin({}, {
    productionAiApiTarget: "https://lingoclub.vercel.app",
    fetchImpl: async () => { proxyCalls += 1; return new Response("{}", { status: 200 }); },
  }));
  const res = response();

  await middleware(request("POST", "/api/ai-credentials", JSON.stringify({ apiKey: "test-only" }), "Bearer test-session-token"), res, () => {});

  assert.equal(proxyCalls, 0);
  assert.equal(res.statusCode, 503);
});

test("preview middleware does not activate the development Production AI proxy", async () => {
  let proxyCalls = 0;
  const middleware = installMiddleware(localApiPlugin({}, {
    productionAiApiTarget: "https://lingoclub.vercel.app",
    fetchImpl: async () => { proxyCalls += 1; return new Response("{}", { status: 200 }); },
  }), "configurePreviewServer");
  const res = response();

  await middleware(request("GET", "/api/ai-credentials", "", "Bearer test-session-token"), res, () => {});

  assert.equal(proxyCalls, 0);
  assert.notEqual(res.statusCode, 200);
});
