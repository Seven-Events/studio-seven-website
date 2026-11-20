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

test("days are closed, no-delivery, or open; weekly shop and delivery days are separate", () => {
  assert.deepEqual(dayStatus(sched, "2027-05-11"), { closed: true, noPickup: true, noDelivery: true, note: "Family trip" });
  assert.deepEqual(dayStatus(sched, "2027-05-14"), { closed: false, noPickup: false, noDelivery: true, note: "" });
  assert.equal(dayStatus(sched, "2027-05-16").noDelivery, true); // a Sunday
  assert.deepEqual(dayStatus(sched, "2027-05-13"), { closed: false, noPickup: false, noDelivery: false, note: "" });
  const weekly = normalize({ cw: [0, 1], dw: [0, 3] }, NOW); // shop shut Sun + Mon; no deliveries Sun + Wed
  assert.deepEqual(dayStatus(weekly, "2027-05-16"), { closed: true, noPickup: true, noDelivery: true, note: "" }); // Sunday: nothing
  assert.deepEqual(dayStatus(weekly, "2027-05-17"), { closed: false, noPickup: true, noDelivery: false, note: "" }); // Monday: delivery only
  assert.deepEqual(dayStatus(weekly, "2027-05-19"), { closed: false, noPickup: false, noDelivery: true, note: "" }); // Wednesday: pickup only
});

test("on a day the shop is shut but deliveries run, delivery is fine and pickup or coffee isn't", () => {
  const m = { ...menu, schedule: normalize({ cw: [1] }, NOW) }; // Mondays
  const o = (fulfillment, cart = flowers) => buildSquareOrder({ cart, customer: cust, fulfillment, menu: m, delivery: { km: 10, fee: 1250 }, locationId: "L1", now: NOW });
  assert.equal(o({ flowers: "delivery", address: "1 Main St", date: "2027-05-10" }).fulfillments[0].type, "DELIVERY");
  assert.throws(() => o({ flowers: "pickup", date: "2027-05-10" }), /shop is closed on Monday, May 10.*choose delivery/);
  assert.throws(() => o({ coffeeTime: "asap" }, [latte]), /shop is closed today/); // NOW is a Monday
  assert.equal(o({ flowers: "delivery", address: "1 Main St" }).fulfillments[0].delivery_details.schedule_type, "ASAP");
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
  assert.deepEqual(deliveryRules({ r: 100 }), { perKm: 100, maxKm: 35, minFee: 1000, from: "41 King St E, Omemee, ON K0L 2W0", lat: 44.3003656, lon: -78.5545074 });
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

test("a read Square refuses for permission explains which permission; a field that doesn't exist yet reads as no days off", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const fail = (status, code, detail) => { const e = new Error(detail); e.status = status; e.errors = [{ code, detail }]; return e; };
  const denied = await adminSchedule({ password: "roses" }, { square: async () => { throw fail(403, "INSUFFICIENT_SCOPES", "The merchant has not given your application sufficient permissions"); }, wait: noWait, now: NOW });
  assert.equal(denied.status, 502);
  assert.match(denied.body.error, /Merchant profile read and write.*INSUFFICIENT_SCOPES/);
  const fresh = await adminSchedule({ password: "roses" }, { square: async () => { throw fail(400, "BAD_REQUEST", "No matching definition found for value"); }, wait: noWait, now: NOW });
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.body.schedule, { c: [], d: [], cw: [], dw: [] });
  const other = await adminSchedule({ password: "roses", schedule: {} }, { square: async () => { throw fail(500, "INTERNAL_SERVER_ERROR", "boom"); }, wait: noWait, now: NOW });
  assert.match(other.body.error, /didn't save it.*INTERNAL_SERVER_ERROR: boom/);
  restore();
});

test("the first save makes the field (checking first), and waits a moment if Square isn't ready with it yet", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const fail = (status, code, detail) => { const e = new Error(detail); e.status = status; e.errors = [{ code, detail }]; return e; };
  const calls = []; let defined = false, upserts = 0;
  const sq = async (path, body, method) => {
    calls.push([path, method]);
    if (path === "/v2/locations/custom-attribute-definitions/website_settings") { if (!defined) throw fail(404, "NOT_FOUND", "nf"); return {}; }
    if (path === "/v2/locations/custom-attribute-definitions") { defined = true; assert.notEqual(body.idempotency_key, "s7-closed-days-definition"); return {}; }
    upserts++;
    if (!defined || upserts < 3) throw fail(400, "BAD_REQUEST", "No matching definition found for value");
    return {};
  };
  const res = await adminSchedule({ password: "roses", schedule: { dw: [0] } }, { square: sq, wait: noWait, now: NOW });
  restore();
  assert.equal(res.status, 200);
  assert.equal(upserts, 3);
  assert.equal(calls.filter((c) => c[0] === "/v2/locations/custom-attribute-definitions").length, 1);
});

test("saves send version -1, and fall back to the current version if Square insists", async () => {
  const restore = env({ STAFF_PASSWORD: "roses", SQUARE_LOCATION_ID: "L1", SQUARE_ACCESS_TOKEN: "t" });
  const fail = (status, code, detail, field) => { const e = new Error(detail); e.status = status; e.errors = [{ code, detail, field }]; return e; };
  const sent = [];
  const easy = async (path, body, method) => { if (method !== "GET") sent.push(body.custom_attribute.version); return {}; };
  assert.equal((await adminSchedule({ password: "roses", schedule: {} }, { square: easy, wait: noWait, now: NOW })).status, 200);
  assert.deepEqual(sent, [-1]);
  const tried = [];
  const strict = async (path, body, method) => {
    if (method === "GET") return { custom_attribute: { value: "{}", version: 4 } };
    tried.push(body.custom_attribute.version);
    if (body.custom_attribute.version !== 4) throw fail(400, "BAD_REQUEST", "Missing required parameter `version`", "version");
    return {};
  };
  const res = await adminSchedule({ password: "roses", schedule: { cw: [0] } }, { square: strict, wait: noWait, now: NOW });
  restore();
  assert.equal(res.status, 200);
  assert.deepEqual(tried, [-1, 4]);
});

test("short deliveries cost the minimum, which can be changed at the admin page", async () => {
  const restore = env({ GOOGLE_MAPS_API_KEY: undefined });
  const near = await quoteDelivery("3 Sturgeon Rd, Omemee", null, { fetch: fakeMaps({ meters: 3000 }).f });
  assert.deepEqual([near.km, near.fee], [3, 1000]); // 3 km x $1.25 = $3.75, so the $10 minimum
  const lower = await quoteDelivery("4 Sturgeon Rd, Omemee", { mn: 500 }, { fetch: fakeMaps({ meters: 3000 }).f });
  assert.equal(lower.fee, 500);
  const far = await quoteDelivery("9 Kent St W, Lindsay", null, { fetch: fakeMaps({ meters: 20100 }).f });
  assert.equal(far.fee, 2513); // above the minimum, so per km
  assert.equal(normalize({ mn: 1500 }, NOW).mn, 1500);
  restore();
});
