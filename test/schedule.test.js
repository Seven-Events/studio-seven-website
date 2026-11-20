const test = require("node:test");
const assert = require("node:assert");
const fx = require("./fixtures/square-catalog.json");
const { buildMenu } = require("../lib/catalog");
const { buildSquareOrder } = require("../lib/order");
const { adminSchedule, loadSchedule, dayStatus, normalize } = require("../lib/schedule");
const { quoteDelivery, deliveryRules } = require("../lib/delivery");

const NOW = new Date("2027-05-03T14:00:00Z"); // Monday May 3, 10:00 in Omemee
const env = (vars) => { const old = {}; for (const k in vars) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } return () => env(old); };
const noWait = async () => {};
const cust = { name: "Sam", phone: "7055550142" };
const flowers = [{ id: "I_market", v: "V_market_0", q: 1 }];
const latte = { id: "I_latte", v: "V_latte_1", mods: ["ML_MILK_0"], q: 1 };
const sched = normalize({ c: [["2027-05-10", "2027-05-12", "Family trip"], ["2027-05-03", "2027-05-03"]], d: [["2027-05-14", "2027-05-14"]], cw: [], dw: [0] }, NOW);
const menu = { ...buildMenu(fx.objects, fx.counts, "L1"), schedule: sched };
const order = (fulfillment, cart = flowers, now = NOW) => buildSquareOrder({ cart, customer: cust, fulfillment, menu, delivery: { km: 10, fee: 1250 }, locationId: "L1", now });

test("days are closed, no-delivery, or open; weekly days repeat", () => {
  assert.deepEqual(dayStatus(sched, "2027-05-11"), { closed: true, noDelivery: true, note: "Family trip" });
  assert.deepEqual(dayStatus(sched, "2027-05-14"), { closed: false, noDelivery: true, note: "" });
  assert.equal(dayStatus(sched, "2027-05-16").noDelivery, true); // a Sunday
  assert.deepEqual(dayStatus(sched, "2027-05-13"), { closed: false, noDelivery: false, note: "" });
});

test("tidying drops past and impossible days, swaps backwards ranges and keeps the delivery rate", () => {
  const n = normalize({ c: [["2027-04-01", "2027-04-02"], ["2027-06-05", "2027-06-01", "<b>x</b>"], ["2027-02-30"]], cw: [1, 1, 9], r: 150, mx: "40" }, NOW);
  assert.deepEqual(n.c, [["2027-06-01", "2027-06-05", "b x /b"]]);
  assert.deepEqual(n.cw, [1]);
  assert.equal(n.r, 150); assert.equal(n.mx, 40);
  assert.equal(normalize({ r: -1, mx: 0 }, NOW).r, undefined);
});

test("checkout refuses closed days, and delivery on no-delivery days but not pickup", () => {
  assert.throws(() => order({ flowers: "pickup", date: "2027-05-11" }), /closed on Tuesday, May 11 \(Family trip\)/);
  assert.throws(() => order({ flowers: "delivery", address: "1 Main St", date: "2027-05-14" }), /not delivering on Friday, May 14/);
  assert.equal(order({ flowers: "pickup", date: "2027-05-14" }).fulfillments[0].type, "PICKUP");
  assert.equal(order({ flowers: "delivery", address: "1 Main St", date: "2027-05-13" }).fulfillments[0].type, "DELIVERY");
});

test("when today is closed, coffee and soonest flowers are refused", () => {
  assert.throws(() => order({ coffeeTime: "asap" }, [latte]), /closed today/);
  assert.throws(() => order({ flowers: "pickup" }), /pick a day/);
  const tue = new Date("2027-05-04T14:00:00Z");
  assert.equal(order({ coffeeTime: "asap" }, [latte], tue).fulfillments[0].type, "PICKUP");
});

function fakeSquare({ saved, missingDefinition = false } = {}) {
  const calls = []; let defined = !missingDefinition;
  const call = async (path, body, method) => {
    calls.push([path, body, method]);
    if (path === "/v2/locations/custom-attribute-definitions") { defined = true; return {}; }
    if (method === "GET") { if (!saved) { const e = new Error("nf"); e.status = 404; throw e; } return { custom_attribute: { value: saved } }; }
    if (!defined) { const e = new Error("nf"); e.status = 404; throw e; }
    return {};
  };
  return { call, calls };
}

test("the admin page needs the staff password, reads, and saves to the Square location", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const sq = fakeSquare({ missingDefinition: true });
  assert.equal((await adminSchedule({ password: "nope" }, { square: sq.call, wait: noWait })).status, 401);
  assert.equal(sq.calls.length, 0);
  const read = await adminSchedule({ password: "roses" }, { square: sq.call, wait: noWait, now: NOW });
  assert.deepEqual(read.body.schedule, { c: [], d: [], cw: [], dw: [] });
  const res = await adminSchedule({ password: "roses", schedule: { c: [["2027-12-25", "2027-12-26", "Christmas"]], dw: [0], r: 125, mx: 35 } }, { square: sq.call, wait: noWait, now: NOW });
  restore();
  assert.equal(res.status, 200);
  assert.ok(sq.calls.some((c) => c[0] === "/v2/locations/custom-attribute-definitions")); // made the attribute on the first save
  const up = sq.calls.filter((c) => c[0] === "/v2/locations/L1/custom-attributes/website_settings" && c[2] !== "GET").pop();
  assert.deepEqual(JSON.parse(up[1].custom_attribute.value), { c: [["2027-12-25", "2027-12-26", "Christmas"]], d: [], cw: [], dw: [0], r: 125, mx: 35 });
  const back = await loadSchedule({ call: fakeSquare({ saved: up[1].custom_attribute.value }).call, locationId: "L1", now: NOW });
  assert.equal(back.mx, 35);
});

test("too many days to fit in Square is refused with a plain message", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const c = Array.from({ length: 40 }, (_, i) => [`2027-06-${String((i % 28) + 1).padStart(2, "0")}`, "", "A fairly long note about why"]);
  const res = await adminSchedule({ password: "roses", schedule: { c } }, { square: fakeSquare().call, wait: noWait, now: NOW });
  restore();
  assert.equal(res.status, 400);
});

// Delivery distance, with OpenStreetMap faked out.
function fakeMaps({ meters = 20100, rank = 30, found = true } = {}) {
  const urls = [];
  const f = async (url) => {
    urls.push(url);
    if (url.includes("nominatim")) return { ok: true, json: async () => (found ? [{ lat: "44.356", lon: "-78.739", place_rank: rank, display_name: "12, Kent Street West, Lindsay, Kawartha Lakes, Ontario" }] : []) };
    return { ok: true, json: async () => ({ code: "Ok", routes: [{ distance: meters }] }) };
  };
  return { f, urls };
}

test("delivery costs the per-km rate on the driving distance from the shop", async () => {
  const restore = env({ GOOGLE_MAPS_API_KEY: undefined });
  const m = fakeMaps();
  const q = await quoteDelivery("12 Kent St W, Lindsay", null, { fetch: m.f });
  assert.deepEqual([q.km, q.fee, q.place], [20.1, 2513, "12, Kent Street West, Lindsay, Kawartha Lakes"]);
  assert.match(m.urls[1], /driving\/-78.5545074,44.3003656;-78.739,44.356/);
  const higher = await quoteDelivery("12 Kent St W, Lindsay", { r: 200, mx: 50 }, { fetch: fakeMaps().f });
  assert.equal(higher.fee, 4020);
  restore();
});

test("delivery past the furthest distance, or to an address we can't pin down, is refused", async () => {
  const restore = env({ GOOGLE_MAPS_API_KEY: undefined });
  await assert.rejects(quoteDelivery("99 Far Rd, Peterborough", null, { fetch: fakeMaps({ meters: 35200 }).f }), /35.2 km away and we deliver up to 35 km/);
  await assert.rejects(quoteDelivery("Bobcaygeon", null, { fetch: fakeMaps({ rank: 16 }).f }), /street as well as the town/);
  await assert.rejects(quoteDelivery("1 Nowhere Lane", null, { fetch: fakeMaps({ found: false }).f }), /couldn't find that address/);
  await assert.rejects(quoteDelivery("x", null, { fetch: fakeMaps().f }), /add the delivery address/);
  restore();
  assert.deepEqual(deliveryRules({ r: 100 }), { perKm: 100, maxKm: 35, from: "41 King St E, Omemee, ON K0L 2W0", lat: 44.3003656, lon: -78.5545074 });
});

test("with a Google key, Google's Routes API measures the drive", async () => {
  const restore = env({ GOOGLE_MAPS_API_KEY: "g" });
  let seen;
  const f = async (url, init) => { seen = [url, init]; return { ok: true, json: async () => ({ routes: [{ distanceMeters: 8040 }] }) }; };
  const q = await quoteDelivery("5 Sturgeon Rd, Omemee", null, { fetch: f });
  restore();
  assert.equal(q.fee, 1000); // 8.0 km x $1.25
  assert.match(seen[0], /routes.googleapis.com/);
  assert.equal(JSON.parse(seen[1].body).destination.address, "5 Sturgeon Rd, Omemee, Ontario, Canada");
});

test("a read Square refuses for permission explains which permission; other first-read errors make the field and retry", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const fail = (status, code, detail) => { const e = new Error(detail); e.status = status; e.errors = [{ code, detail }]; return e; };
  const denied = await adminSchedule({ password: "roses" }, { square: async () => { throw fail(403, "INSUFFICIENT_SCOPES", "The merchant has not given your application sufficient permissions"); }, wait: noWait, now: NOW });
  assert.equal(denied.status, 502);
  assert.match(denied.body.error, /Merchant profile read and write.*INSUFFICIENT_SCOPES/);
  const calls = []; let defined = false;
  const odd = async (path, body, method) => {
    calls.push(path);
    if (path === "/v2/locations/custom-attribute-definitions") { defined = true; return {}; }
    if (!defined) throw fail(400, "BAD_REQUEST", "Custom attribute definition is missing");
    throw fail(404, "NOT_FOUND", "not set");
  };
  const ok = await adminSchedule({ password: "roses" }, { square: odd, wait: noWait, now: NOW });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.schedule, { c: [], d: [], cw: [], dw: [] });
  const other = await adminSchedule({ password: "roses", schedule: {} }, { square: async () => { throw fail(500, "INTERNAL_SERVER_ERROR", "boom"); }, wait: noWait, now: NOW });
  assert.match(other.body.error, /didn't save it.*INTERNAL_SERVER_ERROR: boom/);
  restore();
});
