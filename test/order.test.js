const test = require("node:test");
const assert = require("node:assert");
const menu = require("../public/menu.json");
const { priceCart, buildSquareOrder, OrderError } = require("../lib/order");

const NOW = new Date("2027-05-03T14:00:00Z"); // 10:00 in Omemee
const cust = { name: "Sam", phone: "(705) 555-0142" };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(NOW.getTime() + n * 86400000));

test("prices a latte from the menu, ignoring anything the browser claims", () => {
  const { lines } = priceCart([{ kind: "coffee", id: "latte", size: 2, milk: 2, adds: [0, 0, 1], q: 2, p: 1 }], menu, NOW);
  // 525 + 110 (16 oz) + 75 (oat) + 100 (shot, counted once) + 60 (vanilla)
  assert.equal(lines[0].base_price_money.amount, 870);
  assert.equal(lines[0].quantity, "2");
  assert.equal(lines[0].variation_name, "16 oz, Oat milk, Extra shot, Vanilla");
});

test("espresso ignores size and milk choices", () => {
  const { lines } = priceCart([{ kind: "coffee", id: "esp", size: 2, milk: 2, q: 1 }], menu, NOW);
  assert.equal(lines[0].base_price_money.amount, 325);
});

test("rejects unknown items, bad options and silly quantities", () => {
  assert.throws(() => priceCart([{ kind: "coffee", id: "nope", q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ kind: "coffee", id: "latte", size: 9, q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ kind: "coffee", id: "latte", q: 0 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ kind: "coffee", id: "latte", q: 1.5 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([], menu, NOW), OrderError);
});

test("flower pre-order must be 2 to 60 days out", () => {
  assert.throws(() => priceCart([{ kind: "flowers", id: "market", preorderDate: inDays(1), q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ kind: "flowers", id: "market", preorderDate: inDays(61), q: 1 }], menu, NOW), OrderError);
  const r = priceCart([{ kind: "flowers", id: "arr", size: 2, occasion: 1, preorderDate: inDays(10), card: "Happy birthday!", q: 1 }], menu, NOW);
  assert.equal(r.lines[0].base_price_money.amount, 12500);
  assert.match(r.lines[0].note, /PRE-ORDER/);
  assert.match(r.lines[0].note, /Birthday/);
  assert.match(r.lines[0].note, /Happy birthday!/);
});

test("coffee order becomes an ASAP pickup with HST", () => {
  const o = buildSquareOrder({ cart: [{ kind: "coffee", id: "capp", q: 1 }], customer: cust, fulfillment: { coffeeTime: "asap" }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].type, "PICKUP");
  assert.equal(o.fulfillments[0].pickup_details.schedule_type, "ASAP");
  assert.equal(o.fulfillments[0].pickup_details.recipient.phone_number, "+17055550142");
  assert.deepEqual(o.taxes[0], { uid: "hst", name: "HST", percentage: "13", scope: "ORDER" });
  assert.equal(o.service_charges, undefined);
});

test("scheduled coffee time must be within 4 hours", () => {
  const ok = new Date(NOW.getTime() + 30 * 60000).toISOString();
  const o = buildSquareOrder({ cart: [{ kind: "coffee", id: "capp", q: 1 }], customer: cust, fulfillment: { coffeeTime: ok }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, ok);
  const late = new Date(NOW.getTime() + 6 * 3600000).toISOString();
  assert.throws(() => buildSquareOrder({ cart: [{ kind: "coffee", id: "capp", q: 1 }], customer: cust, fulfillment: { coffeeTime: late }, menu, locationId: "L1", now: NOW }), OrderError);
});

test("flower delivery adds the fee and schedules for the pre-order date at noon shop time", () => {
  const date = inDays(5);
  const o = buildSquareOrder({ cart: [{ kind: "flowers", id: "market", preorderDate: date, q: 1 }], customer: cust, fulfillment: { flowers: "delivery", address: "12 King St E, Omemee" }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].type, "DELIVERY");
  assert.equal(o.service_charges[0].amount_money.amount, 1200);
  assert.equal(o.fulfillments[0].delivery_details.deliver_at, `${date}T16:00:00.000Z`); // noon EDT
});

test("coffee can't be delivered, and delivery needs an address and phone", () => {
  const mixed = [{ kind: "flowers", id: "market", q: 1 }, { kind: "coffee", id: "latte", q: 1 }];
  assert.throws(() => buildSquareOrder({ cart: mixed, customer: cust, fulfillment: { flowers: "delivery", address: "12 King St" }, menu, locationId: "L1", now: NOW }), /pickup only/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: cust, fulfillment: { flowers: "delivery" }, menu, locationId: "L1", now: NOW }), /address/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: { name: "Sam", phone: "555" }, fulfillment: {}, menu, locationId: "L1", now: NOW }), /10-digit/);
});

test("winter pre-orders use standard time", () => {
  const o = buildSquareOrder({ cart: [{ kind: "flowers", id: "bud", preorderDate: "2027-12-20", q: 1 }], customer: cust, fulfillment: { flowers: "pickup" }, menu, locationId: "L1", now: new Date("2027-11-15T15:00:00Z") });
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, "2027-12-20T15:00:00.000Z"); // 10:00 EST
});
