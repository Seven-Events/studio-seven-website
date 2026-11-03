// POST /api/checkout
// 1. Re-prices the cart from menu.json and creates a Square order (it shows up in Square POS for staff).
// 2. Charges the card / Apple Pay / Google Pay token for exactly the order total Square calculated.
const menu = require("../../public/menu.json");
const { buildSquareOrder, OrderError, normalizePhone } = require("../../lib/order");
const { square, SquareError, friendlyPaymentError } = require("../../lib/square");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

exports.handler = async (event, _context, deps = {}) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST." });
  if (process.env.ORDERS_OPEN === "false") return json(503, { error: "Online ordering is paused right now. Please order at the counter." });
  const { SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID } = process.env;
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) return json(500, { error: "Online ordering isn't set up yet." });
  if ((event.body || "").length > 50000) return json(413, { error: "That order is too large." });

  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request." }); }
  const { cart, customer, fulfillment, sourceId, verificationToken, idempotencyKey } = input;
  if (typeof sourceId !== "string" || !sourceId) return json(400, { error: "Payment details are missing. Please try again." });
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(idempotencyKey)) return json(400, { error: "Bad request." });

  const call = deps.square || square;
  try {
    const order = buildSquareOrder({ cart, customer, fulfillment, menu, locationId: SQUARE_LOCATION_ID });
    const created = await call("/v2/orders", { idempotency_key: idempotencyKey + "-order", order });
    const o = created.order;

    let payment;
    try {
      const paid = await call("/v2/payments", {
        source_id: sourceId,
        verification_token: verificationToken || undefined,
        idempotency_key: idempotencyKey + "-pay",
        amount_money: o.total_money,
        order_id: o.id,
        location_id: SQUARE_LOCATION_ID,
        buyer_phone_number: normalizePhone(customer.phone),
        note: "Studio Seven website order",
      });
      payment = paid.payment;
    } catch (err) {
      if (err instanceof SquareError) return json(402, { error: friendlyPaymentError(err) });
      throw err;
    }

    return json(200, {
      orderId: o.id,
      total: o.total_money,
      receiptUrl: payment && payment.receipt_url,
      fulfillment: o.fulfillments && o.fulfillments[0] && o.fulfillments[0].type,
    });
  } catch (err) {
    if (err instanceof OrderError) return json(400, { error: err.message });
    console.error("checkout failed", err && err.errors ? JSON.stringify(err.errors) : err);
    return json(502, { error: "Something went wrong on our side and nothing was charged. Please try again, or call the shop." });
  }
};
