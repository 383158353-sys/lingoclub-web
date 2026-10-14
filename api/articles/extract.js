import { handleArticleExtract } from "../../server/articleExtract.js";

export default async function api(req, res) {
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { body = null; }
  return handleArticleExtract(req, res, body);
}
