// Public values the payment form needs. None of these are secret.
exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify({
    appId: process.env.SQUARE_APP_ID || "",
    locationId: process.env.SQUARE_LOCATION_ID || "",
    env: process.env.SQUARE_ENV === "production" ? "production" : "sandbox",
    ordersOpen: process.env.ORDERS_OPEN !== "false",
  }),
});
