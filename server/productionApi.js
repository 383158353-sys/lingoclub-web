export function productionApi(handle) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "JSON object required" }));
        return;
      }
      await handle(req, res, body, process.env);
    } catch (error) {
      res.statusCode = error instanceof SyntaxError ? 400 : 502;
      res.end(JSON.stringify({ error: error instanceof SyntaxError ? "Invalid JSON" : "服务暂时不可用，请稍后重试" }));
    }
  };
}
