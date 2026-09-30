import assert from "node:assert/strict";
import test from "node:test";
import { productionApi } from "./productionApi.js";

function response() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } };
}

test("production API forwards parsed JSON and server environment", async () => {
  for (const body of [{ task: "translate_sentence" }, '{"task":"translate_sentence"}']) {
    const res = response();
    await productionApi(async (_req, out, parsed, env) => {
      assert.equal(parsed.task, "translate_sentence");
      assert.equal(env, process.env);
      out.end('{"ok":true}');
    })({ method: "POST", body }, res);
    assert.equal(res.body.ok, true);
    assert.equal(res.headers["Cache-Control"], "no-store");
  }
});

test("production API rejects invalid requests and hides upstream secrets", async () => {
  const handler = productionApi(async () => { throw new Error("private upstream credential"); });
  for (const [req, status] of [
    [{ method: "GET" }, 405],
    [{ method: "POST", body: "{" }, 400],
    [{ method: "POST", body: [] }, 400],
    [{ method: "POST", body: {} }, 502],
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, status);
    assert.ok(!JSON.stringify(res.body).includes("private upstream credential"));
  }
});
