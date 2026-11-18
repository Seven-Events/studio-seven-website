// GET /api/config — public values the payment form needs. None of these are secret.
module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    appId: process.env.SQUARE_APP_ID || "",
    locationId: process.env.SQUARE_LOCATION_ID || "",
    env: process.env.SQUARE_ENV === "production" ? "production" : "sandbox",
    ordersOpen: process.env.ORDERS_OPEN !== "false",
    newsletterUrl: process.env.NEWSLETTER_URL || "",
  }));
};
