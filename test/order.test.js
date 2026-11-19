const test = require("node:test");
const assert = require("node:assert");
const fx = require("./fixtures/square-catalog.json");
const { buildMenu, settings } = require("../lib/catalog");
const { priceCart, buildSquareOrder, OrderError, openChristmasDates } = require("../lib/order");

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

test("flower pre-order date is chosen at checkout, must be 2 to 60 days out, and goes on every flower line", () => {
  const order = (date, cart = [{ id: "I_market", v: "V_market_0", q: 1 }]) => buildSquareOrder({ cart, customer: cust, fulfillment: { flowers: "pickup", date }, menu, locationId: "L1", now: NOW });
  assert.throws(() => order(inDays(1)), /2 to 60 days/);
  assert.throws(() => order(inDays(61)), /2 to 60 days/);
  assert.throws(() => order("next tuesday"), /valid date/);
  const o = order(inDays(10), [{ id: "I_arr", v: "V_arr_2", occasion: 1, card: "Happy birthday!", q: 1 }, { id: "I_bud", q: 1 }]);
  assert.equal(o.fulfillments[0].pickup_details.schedule_type, "SCHEDULED");
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, `${inDays(10)}T14:00:00.000Z`); // 10:00 EDT
  assert.match(o.line_items[0].note, new RegExp(`^PRE-ORDER for ${inDays(10)} \\| For: Birthday \\| Card: "Happy birthday!"$`));
  assert.match(o.line_items[1].note, /^PRE-ORDER for/);
  assert.equal(o.line_items[0]._flower, undefined);
});

test("flowers without a date are a same-day pickup", () => {
  const o = buildSquareOrder({ cart: [{ id: "I_market", v: "V_market_0", q: 1 }], customer: cust, fulfillment: { flowers: "pickup" }, menu, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].pickup_details.schedule_type, "ASAP");
  assert.doesNotMatch(o.line_items[0].note, /PRE-ORDER/);
});

test("pre-ordered flowers can't share an order with today's coffee", () => {
  assert.throws(() => buildSquareOrder({ cart: [{ id: "I_market", v: "V_market_0", q: 1 }, latte], customer: cust, fulfillment: { flowers: "pickup", coffeeTime: "asap", date: inDays(5) }, menu, locationId: "L1", now: NOW }), /separate order/);
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
  const o = buildSquareOrder({ cart: [{ id: "I_market", v: "V_market_0", q: 1 }], customer: cust, fulfillment: { flowers: "delivery", address: "12 King St E, Omemee", date }, menu, delivery: { km: 20.1, fee: 2513 }, locationId: "L1", now: NOW });
  assert.equal(o.fulfillments[0].type, "DELIVERY");
  assert.equal(o.service_charges[0].amount_money.amount, 2513);
  assert.equal(o.service_charges[0].name, "Flower delivery (20.1 km)");
  assert.equal(o.fulfillments[0].delivery_details.deliver_at, `${date}T16:00:00.000Z`); // noon EDT
});

test("coffee can't be delivered, and delivery needs an address and phone", () => {
  const mixed = [{ id: "I_market", v: "V_market_0", q: 1 }, latte];
  assert.throws(() => buildSquareOrder({ cart: mixed, customer: cust, fulfillment: { flowers: "delivery", address: "12 King St" }, menu, locationId: "L1", now: NOW }), /pickup only/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: cust, fulfillment: { flowers: "delivery" }, menu, locationId: "L1", now: NOW }), /address/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: cust, fulfillment: { flowers: "delivery", address: "12 King St" }, menu, locationId: "L1", now: NOW }), /delivery cost/);
  assert.throws(() => buildSquareOrder({ cart: [mixed[0]], customer: { name: "Sam", phone: "555" }, fulfillment: {}, menu, locationId: "L1", now: NOW }), /10-digit/);
});

test("winter pre-orders use standard time", () => {
  const o = buildSquareOrder({ cart: [{ id: "I_bud", q: 1 }], customer: cust, fulfillment: { flowers: "pickup", date: "2027-12-20" }, menu, locationId: "L1", now: new Date("2027-11-15T15:00:00Z") });
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, "2027-12-20T15:00:00.000Z"); // 10:00 EST
});

// Christmas: "Bud Vase Trio" stands in for a holiday item, with two pickup/delivery days set.
const XNOW = new Date("2027-12-15T15:00:00Z"); // Dec 15, 10:00 in Omemee
const xmasMenu = (dates, orderAheadDays = 1) => buildMenu(fx.objects, fx.counts, "L1", { ...settings, christmas: { items: ["bud vase trio"], dates, orderAheadDays } });
const xorder = (m, fulfillment, cart = [{ id: "I_bud", q: 1 }]) => buildSquareOrder({ cart, customer: cust, fulfillment: { flowers: "pickup", ...fulfillment }, menu: m, delivery: { km: 5, fee: 625 }, locationId: "L1", now: XNOW });

test("with no Christmas days set, holiday items sell like any other flowers", () => {
  const m = xmasMenu([]);
  assert.equal(m.flowers.christmas, null);
  assert.equal(m.flowers.items.find((i) => i.id === "I_bud").xmas, undefined);
  assert.equal(xorder(m, {}).fulfillments[0].pickup_details.schedule_type, "ASAP");
});

test("Christmas items must be for one of the Christmas days, which Square gets as the scheduled time", () => {
  const m = xmasMenu(["2027-12-23", "2027-12-20", "bad"]);
  assert.deepEqual(m.flowers.christmas, { dates: ["2027-12-20", "2027-12-23"], orderAheadDays: 1 });
  assert.equal(m.flowers.items.find((i) => i.id === "I_bud").xmas, true);
  assert.throws(() => xorder(m, {}), /Christmas pickup or delivery day/);
  assert.throws(() => xorder(m, { date: "2027-12-21" }), /isn't available/);
  const o = xorder(m, { date: "2027-12-23" }, [{ id: "I_bud", q: 1 }, { id: "I_market", v: "V_market_0", q: 1 }]);
  assert.equal(o.fulfillments[0].pickup_details.pickup_at, "2027-12-23T15:00:00.000Z"); // 10:00 EST
  assert.match(o.line_items[0].note, /^CHRISTMAS PRE-ORDER for 2027-12-23/);
  assert.match(o.line_items[1].note, /^PRE-ORDER for 2027-12-23/);
  const d = xorder(m, { flowers: "delivery", address: "12 King St E, Omemee", date: "2027-12-20" });
  assert.equal(d.fulfillments[0].delivery_details.deliver_at, "2027-12-20T17:00:00.000Z"); // noon EST
});

test("Christmas days close orderAheadDays before, and coffee goes in its own order", () => {
  const m = xmasMenu(["2027-12-16", "2027-12-20"]);
  assert.deepEqual(openChristmasDates(m, XNOW), ["2027-12-16", "2027-12-20"]);
  assert.deepEqual(openChristmasDates(xmasMenu(["2027-12-16", "2027-12-20"], 2), XNOW), ["2027-12-20"]);
  assert.throws(() => xorder(m, { date: "2027-12-15" }), /isn't available/);
  assert.throws(() => xorder(xmasMenu(["2027-12-15"]), { date: "2027-12-15" }), /closed/);
  assert.throws(() => xorder(m, { date: "2027-12-20", coffeeTime: "asap" }, [{ id: "I_bud", q: 1 }, latte]), /separate order/);
  // Regular flowers aren't held to the Christmas days.
  assert.equal(xorder(m, {}, [{ id: "I_market", v: "V_market_0", q: 1 }]).fulfillments[0].pickup_details.schedule_type, "ASAP");
});
