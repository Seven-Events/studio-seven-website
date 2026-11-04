// GET /api/menu — the website menu, read from the shop's Square Item Library.
// Cached at Vercel's edge for a minute, so changes made in Square show up on the site within about a minute.
const { loadMenu } = require("../lib/catalog");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
    res.statusCode = 500; res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ error: "The menu isn't connected to Square yet." }));
  }
  try {
    const menu = await loadMenu();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
    res.end(JSON.stringify(menu));
  } catch (err) {
    console.error("menu failed", err && err.errors ? JSON.stringify(err.errors) : err);
    res.statusCode = 502; res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "The menu didn't load." }));
  }
};
