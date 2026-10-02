import assert from "node:assert/strict";
import test from "node:test";
import { authenticatedUser, serviceRoleProjectMatches } from "./aiCredentials.js";

const env = {
  VITE_SUPABASE_URL: "https://project-ref.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

test("authenticatedUser validates with the publishable client and returns a service-role database client", async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const requests = [];
  const logs = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), headers: new Headers(options?.headers) });
    return new Response(JSON.stringify({ id: "user-123", email: "user@example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  console.info = (...args) => logs.push(args);
  try {
    const { client, user } = await authenticatedUser({ headers: { authorization: "Bearer access-token-value" } }, env);
    assert.equal(user.id, "user-123");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.get("apikey"), env.VITE_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(requests[0].headers.get("authorization"), "Bearer access-token-value");

    await client.from("user_ai_preferences").select("active_credential_id").eq("user_id", user.id);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(requests[1].headers.get("authorization"), `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);

    const diagnostic = logs[0][1];
    assert.deepEqual(diagnostic, {
      bearerPresent: true,
      tokenLength: 18,
      supabaseHost: "project-ref.supabase.co",
      authErrorCode: null,
      authErrorStatus: null,
      userResolved: true,
      serviceRoleClientInitialized: true,
      serviceRoleProjectMatches: null,
    });
    assert.equal(JSON.stringify(logs).includes("access-token-value"), false);
    assert.equal(JSON.stringify(logs).includes(env.VITE_SUPABASE_PUBLISHABLE_KEY), false);
    assert.equal(JSON.stringify(logs).includes(env.SUPABASE_SERVICE_ROLE_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test("authenticatedUser logs the real Supabase auth error code and status without the bearer", async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const logs = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  console.info = (...args) => logs.push(args);
  try {
    await assert.rejects(
      authenticatedUser({ headers: { authorization: "Bearer rejected-token" } }, env),
      (error) => error.code === "AUTH_REQUIRED" && error.status === 401,
    );
    assert.deepEqual(logs[0][1], {
      bearerPresent: true,
      tokenLength: 14,
      supabaseHost: "project-ref.supabase.co",
      authErrorCode: "bad_jwt",
      authErrorStatus: 401,
      userResolved: false,
      serviceRoleClientInitialized: true,
      serviceRoleProjectMatches: null,
    });
    assert.equal(JSON.stringify(logs).includes("rejected-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
  }
});

test("service-role project matching reveals only whether a JWT ref matches the configured host", () => {
  const encoded = Buffer.from(JSON.stringify({ role: "service_role", ref: "project-ref" })).toString("base64url");
  assert.equal(serviceRoleProjectMatches({ ...env, SUPABASE_SERVICE_ROLE_KEY: `header.${encoded}.signature` }), true);
  assert.equal(serviceRoleProjectMatches({ ...env, SUPABASE_SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ ref: "other-project" })).toString("base64url")}.signature` }), false);
});
