const test = require("node:test");
const assert = require("node:assert");
const fx = require("./fixtures/square-catalog.json");
const { buildMenu } = require("../lib/catalog");
const { priceCart, buildSquareOrder, OrderError } = require("../lib/order");

const menu = buildMenu(fx.objects, fx.counts, "L1");
const NOW = new Date("2027-05-03T14:00:00Z"); // 10:00 in Omemee
const cust = { name: "Sam", phone: "(705) 555-0142" };
const iso = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => iso(new Date(NOW.getTime() + n * 86400000));
const latte = { id: "I_latte", v: "V_latte_1", mods: ["ML_MILK_0"], q: 1 };

test("sends Square catalog ids, so Square prices the order itself", () => {
  const { lines } = priceCart([{ id: "I_latte", v: "V_latte_2", mods: ["ML_MILK_2", "ML_ADDS_0", "ML_ADDS_0", "ML_ADDS_1"], note: "extra hot", q: 2, p: 1 }], menu, NOW);
  assert.equal(lines[0].catalog_object_id, "V_latte_2");
  assert.deepEqual(lines[0].modifiers.map((m) => m.catalog_object_id), ["ML_MILK_2", "ML_ADDS_0", "ML_ADDS_1"]);
  assert.equal(lines[0].quantity, "2");
  assert.equal(lines[0].note, "extra hot");
  assert.equal(lines[0].base_price_money, undefined); // never a price from the browser
  assert.equal(lines[0]._unit, 635 + 75 + 100 + 60);
});

test("one-size items need no variation id", () => {
  const { lines } = priceCart([{ id: "I_esp", q: 1 }], menu, NOW);
  assert.equal(lines[0].catalog_object_id, "V_esp_0");
});

test("rejects unknown items, options from other lists, missing required choices and silly quantities", () => {
  assert.throws(() => priceCart([{ id: "nope", q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ id: "I_latte", v: "V_capp_1", mods: ["ML_MILK_0"], q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ id: "I_latte", v: "V_latte_1", q: 1 }], menu, NOW), /choose milk/);
  assert.throws(() => priceCart([{ id: "I_latte", v: "V_latte_1", mods: ["ML_MILK_0", "ML_MILK_1"], q: 1 }], menu, NOW), /Too many/);
  assert.throws(() => priceCart([{ id: "I_esp", mods: ["ML_MILK_0"], q: 1 }], menu, NOW), /isn't available/);
  assert.throws(() => priceCart([{ ...latte, q: 0 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ ...latte, q: 1.5 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([], menu, NOW), OrderError);
});

test("items staff haven't put in a website category don't exist online", () => {
  assert.throws(() => priceCart([{ id: "I_mug", q: 1 }], menu, NOW), /isn't on the menu/);
});

test("sold-out stock is refused, in-stock is fine", () => {
  assert.throws(() => priceCart([{ id: "I_dried", v: "V_dried_1", q: 1 }], menu, NOW), /sold out/);
  assert.equal(priceCart([{ id: "I_dried", v: "V_dried_0", q: 1 }], menu, NOW).lines.length, 1);
});

test("flower pre-order must be 2 to 60 days out and carries its notes", () => {
  assert.throws(() => priceCart([{ id: "I_market", preorderDate: inDays(1), v: "V_market_0", q: 1 }], menu, NOW), OrderError);
  assert.throws(() => priceCart([{ id: "I_market", preorderDate: inDays(61), v: "V_market_0", q: 1 }], menu, NOW), OrderError);
  const r = priceCart([{ id: "I_arr", v: "V_arr_2", occasion: 1, preorderDate: inDays(10), card: "Happy birthday!", q: 1 }], menu, NOW);
  assert.equal(r.lines[0]._unit, 12500);
  assert.match(r.lines[0].note, /PRE-ORDER/);
  assert.match(r.lines[0].note, /Birthday/);
  assert.match(r.lines[0].note, /Happy birthday!/);
});

test("coffee order becomes an ASAP pickup with HST", () => {
  const o = buildSquareOrder({ cart: [latte], customer: cust, fulfillment: { coffeeTime: "asap" }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].type, "PICKUP");
  assert.equal(o.fulfillments[0].pickup_details.schedule_type, "ASAP");
  assert.equal(o.fulfillments[0].pickup_details.recipient.phone_number, "+17055550142");
  assert.deepEqual(o.taxes[0], { uid: "hst", name: "HST", percentage: "13", scope: "ORDER" });
  assert.equal(o.line_items[0]._unit, undefined);
  assert.equal(o.service_charges, undefined);
});

test("scheduled coffee time must be within 4 hours", () => {
  const ok = new Date(NOW.getTime() + 30 * 60000).toISOString();
  const o = buildSquareOrder({ cart: [latte], customer: cust, fulfillment: { coffeeTime: ok }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, ok);
  const late = new Date(NOW.getTime() + 6 * 3600000).toISOString();
  assert.throws(() => buildSquareOrder({ cart: [latte], customer: cust, fulfillment: { coffeeTime: late }, menu, locationId: "L1", now: NOW }), OrderError);
});

test("flower delivery adds the fee and schedules for the pre-order date at noon shop time", () => {
  const date = inDays(5);
  const o = buildSquareOrder({ cart: [{ id: "I_market", v: "V_market_0", preorderDate: date, q: 1 }], customer: cust, fulfillment: { flowers: "delivery", address: "12 King St E, Omemee" }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].type, "DELIVERY");
  assert.equal(o.service_charges[0].amount_money.amount, 1200);
  assert.equal(o.fulfillments[0].delivery_details.deliver_at, `${date}T16:00:00.000Z`); // noon EDT
});

test("coffee can't be delivered, and delivery needs an address and phone", () => {
  const mixed = [{ id: "I_market", v: "V_market_0", q: 1 }, latte];
  assert.throws(() => buildSquareOrder({ cart: mixed, customer: cust, fulfillment: { flowers: "delivery", address: "12 King St" }, menu, locationId: "L1", now: NOW }), /pickup only/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: cust, fulfillment: { flowers: "delivery" }, menu, locationId: "L1", now: NOW }), /address/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: { name: "Sam", phone: "555" }, fulfillment: {}, menu, locationId: "L1", now: NOW }), /10-digit/);
});

test("winter pre-orders use standard time", () => {
  const o = buildSquareOrder({ cart: [{ id: "I_bud", preorderDate: "2027-12-20", q: 1 }], customer: cust, fulfillment: { flowers: "pickup" }, menu, locationId: "L1", now: new Date("2027-11-15T15:00:00Z") });
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, "2027-12-20T15:00:00.000Z"); // 10:00 EST
});
