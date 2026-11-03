const test = require("node:test");
const assert = require("node:assert");
const { checkout } = require("../lib/checkout");
const { SquareError } = require("../lib/square");

process.env.SQUARE_ACCESS_TOKEN = "test"; process.env.SQUARE_LOCATION_ID = "L1";
const input = (extra = {}) => ({ cart: [{ kind: "coffee", id: "latte", q: 1 }], customer: { name: "Sam", phone: "7055550142" }, fulfillment: { coffeeTime: "asap" }, sourceId: "cnon:card-nonce-ok", idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e", ...extra });

test("creates the order, then charges exactly Square's total", async () => {
  const calls = [];
  const fake = async (path, b) => {
    calls.push([path, b]);
    if (path === "/v2/orders") return { order: { id: "ORD1", total_money: { amount: 593, currency: "CAD" }, fulfillments: [{ type: "PICKUP" }] } };
    return { payment: { id: "PAY1", receipt_url: "https://squareup.com/receipt/x" } };
  };
  const res = await checkout(input({ total: 1 }), { square: fake });
  assert.equal(res.status, 200);
  assert.equal(calls[1][1].amount_money.amount, 593);
  assert.equal(calls[1][1].order_id, "ORD1");
  assert.equal(res.body.orderId, "ORD1");
});

test("a declined card gets a plain-English message", async () => {
  const fake = async (path) => {
    if (path === "/v2/orders") return { order: { id: "ORD1", total_money: { amount: 593, currency: "CAD" } } };
    throw new SquareError([{ code: "CARD_DECLINED", detail: "declined" }], 402);
  };
  const res = await checkout(input(), { square: fake });
  assert.equal(res.status, 402);
  assert.match(res.body.error, /declined/);
});

test("bad carts are refused before anything reaches Square", async () => {
  let called = false;
  const res = await checkout(input({ cart: [{ kind: "coffee", id: "free-coffee", q: 1 }] }), { square: async () => { called = true; } });
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("ordering can be paused", async () => {
  process.env.ORDERS_OPEN = "false";
  const res = await checkout(input(), { square: async () => ({}) });
  delete process.env.ORDERS_OPEN;
  assert.equal(res.status, 503);
});
