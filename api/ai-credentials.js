import { handleAICredentials } from "../server/aiCredentialsApi.js";
import { sendCredentialFailure } from "../server/aiCredentialErrors.js";

export default async function api(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    await handleAICredentials(req, res, body, process.env);
  } catch (error) {
    sendCredentialFailure(res, error, "credential_endpoint");
  }
}
