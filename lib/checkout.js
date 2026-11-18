// Checkout, independent of the hosting platform (api/checkout.js wires it up for Vercel).
// 1. Checks the cart against the live Square Item Library (sold-out items are refused) and creates a
//    Square order from catalog items. It shows up in Square POS for staff, and Square counts down stock.
// 2. Charges the card / Apple Pay / Google Pay token for exactly the order total Square calculated.
const { loadMenu } = require("./catalog");
const { buildSquareOrder, OrderError, normalizePhone } = require("./order");
const { square, SquareError, friendlyPaymentError } = require("./square");

async function checkout(input, deps = {}) {
  const reply = (status, body) => ({ status, body });
  if (process.env.ORDERS_OPEN === "false") return reply(503, { error: "Online ordering is paused right now. Please order at the counter." });
  const { SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID } = process.env;
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) return reply(500, { error: "Online ordering isn't set up yet." });
  if (!input || typeof input !== "object") return reply(400, { error: "Bad request." });
  if (JSON.stringify(input).length > 50000) return reply(413, { error: "That order is too large." });

  const { cart, customer, fulfillment, sourceId, verificationToken, idempotencyKey } = input;
  if (typeof sourceId !== "string" || !sourceId) return reply(400, { error: "Payment details are missing. Please try again." });
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9-]{8,40}$/.test(idempotencyKey)) return reply(400, { error: "Bad request." });

  const call = deps.square || square;
  try {
    const menu = await (deps.loadMenu || (() => loadMenu({ call })))();
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
      if (err instanceof SquareError) return reply(402, { error: friendlyPaymentError(err) });
      throw err;
    }

    return reply(200, {
      orderId: o.id,
      total: o.total_money,
      receiptUrl: payment && payment.receipt_url,
      fulfillment: o.fulfillments && o.fulfillments[0] && o.fulfillments[0].type,
    });
  } catch (err) {
    if (err instanceof OrderError) return reply(400, { error: err.message });
    console.error("checkout failed", err && err.errors ? JSON.stringify(err.errors) : err);
    return reply(502, { error: "Something went wrong on our side and nothing was charged. Please try again, or call the shop." });
  }
}

module.exports = { checkout };
