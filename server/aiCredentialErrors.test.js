import test from "node:test";
import assert from "node:assert/strict";
import { classifyCredentialFailure, credentialDiagnosticCategory } from "./aiCredentialErrors.js";

test("credential API failures are classified without returning raw upstream messages", () => {
  const cases = [
    [{ code: "AUTH_REQUIRED", status: 401 }, "auth", 401],
    [{ code: "SERVER_ENV_MISSING" }, "missing_server_env", 503],
    [{ code: "ENCRYPTION_FAILED" }, "encryption", 503],
    [{ code: "42P01", message: "relation user_ai_credentials does not exist" }, "missing_table", 503],
    [{ code: "42501", message: "row-level security policy denied" }, "rls_permission", 403],
    [{ message: "fetch failed" }, "supabase_connection", 503],
  ];
  for (const [error, stage, status] of cases) {
    const result = classifyCredentialFailure(error);
    assert.equal(result.stage, stage);
    assert.equal(result.status, status);
    assert.ok(result.message);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});

test("credential write errors have a stable insert/update phase", () => {
  const result = classifyCredentialFailure({ message: "private upstream error with secret" }, "insert_update");
  assert.equal(result.stage, "insert_update");
  assert.equal(result.message.includes("private upstream"), false);
  assert.equal(result.message.includes("secret"), false);
});

test("credential diagnostics classify database failures without exposing raw messages", () => {
  assert.equal(credentialDiagnosticCategory({ message: "Invalid API key" }), "invalid_api_key");
  assert.equal(credentialDiagnosticCategory({ message: "Could not find the table in the schema cache" }), "missing_table");
  assert.equal(credentialDiagnosticCategory(new TypeError("fetch failed")), "connection_failed");
});
