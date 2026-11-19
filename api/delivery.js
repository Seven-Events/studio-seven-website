// POST /api/delivery { address } — the delivery cost for an address, shown at checkout. See lib/delivery.js
const route = require("../lib/vercel");
const { quoteDelivery, DeliveryError } = require("../lib/delivery");
const { loadSchedule } = require("../lib/schedule");

module.exports = route(async (body) => {
  try {
    const schedule = await loadSchedule().catch(() => null);
    const q = await quoteDelivery(body && body.address, schedule);
    return { status: 200, body: q };
  } catch (err) {
    if (err instanceof DeliveryError) return { status: 400, body: { error: err.message } };
    console.error("delivery quote failed", err);
    return { status: 502, body: { error: "We couldn't work out the delivery cost just now. Please try again." } };
  }
});
