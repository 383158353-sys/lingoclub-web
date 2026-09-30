import { fetchDoubanPoster } from "../server/posterSearch.js";

export default async function doubanPoster(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { bytes, contentType } = await fetchDoubanPoster(String(req.query?.url || ""));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "DOUBAN_POSTER_UNAVAILABLE", message: error?.message || "豆瓣封面暂时无法读取" });
  }
}
