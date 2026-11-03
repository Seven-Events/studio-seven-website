// Adapts the platform-independent handlers in lib/ to Vercel's (req, res) functions.
module.exports = function route(handler) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "Use POST." })); }
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const out = await handler(body);
    res.statusCode = out.status;
    res.end(JSON.stringify(out.body));
  };
};
