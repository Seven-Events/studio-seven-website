const test = require("node:test");
const assert = require("node:assert");
const fx = require("./fixtures/square-catalog.json");
const { buildMenu } = require("../lib/catalog");
const { buildSquareOrder } = require("../lib/order");
const { parseHours, loadHours, coffeeOpenAt } = require("../lib/hours");

// Square's shape: Mon-Fri 7:00-15:00, Sat 8:00-14:00, closed Sunday.
const periods = [..."MON TUE WED THU FRI".split(" ").map((d) => ({ day_of_week: d, start_local_time: "07:00:00", end_local_time: "15:00:00" })),
  { day_of_week: "SAT", start_local_time: "08:00:00", end_local_time: "14:00:00" }];
const hours = parseHours(periods);
const menu = { ...buildMenu(fx.objects, fx.counts, "L1"), hours };
const cust = { name: "Sam", phone: "7055550142" };
const latte = { id: "I_latte", v: "V_latte_1", mods: ["ML_MILK_0"], q: 1 };
const at = (s) => new Date(s); // times below are UTC; Omemee is UTC-4 in May
const order = (fulfillment, now) => buildSquareOrder({ cart: [latte], customer: cust, fulfillment, menu, locationId: "L1", now });

test("reads Square's business hours into minutes per weekday", () => {
  assert.deepEqual(hours[1], [[420, 900]]);
  assert.deepEqual(hours[6], [[480, 840]]);
  assert.deepEqual(hours[0], []);
  assert.equal(parseHours([]), null);
  assert.equal(parseHours(undefined), null);
});

test("coffee only while open, with last orders 15 minutes before closing", () => {
  assert.equal(coffeeOpenAt(hours, at("2027-05-03T10:59:00Z")), false); // Mon 6:59
  assert.equal(coffeeOpenAt(hours, at("2027-05-03T11:00:00Z")), true);  // Mon 7:00
  assert.equal(coffeeOpenAt(hours, at("2027-05-03T18:45:00Z")), true);  // Mon 14:45
  assert.equal(coffeeOpenAt(hours, at("2027-05-03T18:50:00Z")), false); // Mon 14:50
  assert.equal(coffeeOpenAt(hours, at("2027-05-02T15:00:00Z")), false); // Sunday
  assert.equal(coffeeOpenAt(null, at("2027-05-02T03:00:00Z")), true);   // no hours set: not limited
});

test("checkout refuses coffee times when the shop is closed", () => {
  const morning = at("2027-05-03T10:00:00Z"); // Mon 6:00, before opening
  assert.throws(() => order({ coffeeTime: "asap" }, morning), /shop is closed/);
  assert.throws(() => order({ coffeeTime: "2027-05-03T10:30:00.000Z" }, morning), /closed at that time/);
  assert.equal(order({ coffeeTime: "2027-05-03T11:15:00.000Z" }, morning).fulfillments[0].pickup_details.pickup_at, "2027-05-03T11:15:00.000Z");
  assert.equal(order({ coffeeTime: "asap" }, at("2027-05-03T14:00:00Z")).fulfillments[0].pickup_details.schedule_type, "ASAP");
  assert.throws(() => order({ coffeeTime: "2027-05-03T19:00:00.000Z" }, at("2027-05-03T17:00:00Z")), /closed at that time/); // 15:00
});

test("loads hours from the Square location, and copes when Square has none or fails", async () => {
  let asked;
  const got = await loadHours({ locationId: "L1", call: async (path) => { asked = path; return { location: { business_hours: { periods } } }; } });
  assert.equal(asked, "/v2/locations/L1");
  assert.deepEqual(got, hours);
  assert.equal(await loadHours({ locationId: "L1", call: async () => ({ location: {} }) }), null);
  const err = console.error; console.error = () => {};
  try { assert.equal(await loadHours({ locationId: "L1", call: async () => { throw new Error("down"); } }), null); }
  finally { console.error = err; }
});
