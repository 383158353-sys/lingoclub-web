import test from "node:test";
import assert from "node:assert/strict";
import { createRequestDeduper } from "../src/lib/requestDeduper.js";

test("request deduper reuses the in-flight promise for the same key", async () => {
  const dedupe = createRequestDeduper();
  let calls = 0;
  let resolveRequest;
  const task = () => {
    calls += 1;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };

  const first = dedupe("user-1", task);
  const second = dedupe("user-1", task);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  resolveRequest("done");
  assert.equal(await second, "done");
});

test("request deduper permits a new request after settlement", async () => {
  const dedupe = createRequestDeduper();
  let calls = 0;
  const task = async () => ++calls;

  assert.equal(await dedupe("user-1", task), 1);
  await Promise.resolve();
  assert.equal(await dedupe("user-1", task), 2);
});
