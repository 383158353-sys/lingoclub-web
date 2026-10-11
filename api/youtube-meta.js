import { handleYouTubeMeta } from "../server/youtubeMeta.js";

export default async function api(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (String(req.method || "").toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    await handleYouTubeMeta(req, res, body, process.env);
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid request" }));
  }
}
