import { searchLocalPosters } from "../server/posterSearch.js";

export default async function posterSearch(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const result = await searchLocalPosters({
      query: req.query?.query,
      type: req.query?.type,
      seasonNumber: req.query?.season,
    }, process.env);
    res.status(200).json(result);
  } catch (error) {
    res.status(502).json({ error: "POSTER_SEARCH_FAILED", message: error?.message || "封面搜索暂时失败" });
  }
}
