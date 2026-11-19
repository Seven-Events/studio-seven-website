// Closed days, no-delivery days and the delivery rate, set by staff at /admin.html.
// Saved in Square on the shop location, as a custom attribute ("Website settings"), so there's
// no extra database: the menu reads it with everything else, and checkout refuses blocked days.
//
// Stored shape (kept short, because Square limits a text attribute to 1,000 characters):
//   { c: [[from, to, note], ...],  closed (no orders at all), dates as YYYY-MM-DD, to >= from
//     d: [[from, to, note], ...],  no deliveries (pickup still open)
//     cw: [0-6, ...],              closed every week on these days (0 = Sunday)
//     dw: [0-6, ...],              no deliveries every week on these days
//     r: 125, mx: 35 }             delivery cents per km and furthest km; left out = shop-settings.json
const crypto = require("crypto");
const { square } = require("./square");

const KEY = "website_settings";
const MAX_CHARS = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHOP_TZ = "America/Toronto";
const EMPTY = Object.freeze({ c: [], d: [], cw: [], dw: [] });

const realDay = (s) => DAY.test(s) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const todayInShop = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TZ }).format(now);
const weekday = (s) => new Date(s + "T12:00:00Z").getUTCDay();
const cleanNote = (v) => String(v == null ? "" : v).replace(/[\u0000-\u001f"\\<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

/** Tidies whatever came in (from Square or from the admin page) into the stored shape. Drops days already past. */
function normalize(raw, now = new Date()) {
  const s = raw && typeof raw === "object" ? raw : {};
  const today = todayInShop(now);
  const ranges = (list) => (Array.isArray(list) ? list : [])
    .map((r) => (Array.isArray(r) ? r : [r && r.from, r && r.to, r && r.note]))
    .map(([from, to, note]) => {
      from = String(from || ""); to = String(to || from);
      if (!realDay(from) || !realDay(to)) return null;
      if (to < from) [from, to] = [to, from];
      return [from, to, cleanNote(note)];
    })
    .filter((r) => r && r[1] >= today)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 40);
  const days = (list) => [...new Set((Array.isArray(list) ? list : []).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const out = { c: ranges(s.c), d: ranges(s.d), cw: days(s.cw), dw: days(s.dw) };
  const r = Number(s.r), mx = Number(s.mx);
  if (s.r !== undefined && s.r !== null && s.r !== "" && Number.isInteger(r) && r >= 0 && r <= 2000) out.r = r;
  if (s.mx !== undefined && s.mx !== null && s.mx !== "" && Number.isFinite(mx) && mx >= 1 && mx <= 200) out.mx = Math.round(mx * 10) / 10;
  return out;
}

/** What's happening on a day: { closed, noDelivery, note }. */
function dayStatus(sched, date) {
  const s = sched || EMPTY, wd = weekday(date);
  const hit = (list) => (list || []).find(([from, to]) => date >= from && date <= to);
  const c = hit(s.c);
  if (c || (s.cw || []).includes(wd)) return { closed: true, noDelivery: true, note: (c && c[2]) || "" };
  const d = hit(s.d);
  if (d || (s.dw || []).includes(wd)) return { closed: false, noDelivery: true, note: (d && d[2]) || "" };
  return { closed: false, noDelivery: false, note: "" };
}

/** Reads the saved days from Square. Missing (never saved) means nothing is blocked. */
async function loadSchedule({ call = square, locationId = process.env.SQUARE_LOCATION_ID, now } = {}) {
  try {
    const got = await call(`/v2/locations/${encodeURIComponent(locationId)}/custom-attributes/${KEY}`, undefined, "GET");
    const v = got && got.custom_attribute && got.custom_attribute.value;
    return normalize(typeof v === "string" ? JSON.parse(v) : null, now);
  } catch (err) {
    if (err && err.status === 404) return normalize(null, now);
    throw err;
  }
}

function samePassword(given, expected) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function createDefinition(call) {
  try {
    await call("/v2/locations/custom-attribute-definitions", {
      idempotency_key: "s7-closed-days-definition",
      custom_attribute_definition: {
        key: KEY, name: "Website settings",
        description: "Closed days, no-delivery days and the delivery rate for the website's checkout. Set from the website's /admin.html page.",
        schema: { $ref: "https://developer-production-s.squarecdn.com/schemas/v1/common.json#squareup.common.String" },
        visibility: "VISIBILITY_READ_ONLY",
      },
    });
  } catch (err) {
    const code = err && err.errors && err.errors[0] && err.errors[0].code;
    if (code !== "CONFLICT" && !(err && err.status === 409)) throw err; // already exists is fine
  }
}

/**
 * POST /api/admin
 *   { password }                  -> check the password and return the saved days
 *   { password, schedule: {...} } -> save them
 */
async function adminSchedule(body, { square: call = square, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = new Date() } = {}) {
  const b = body || {};
  if (!process.env.STAFF_PASSWORD) return { status: 503, body: { error: "Saving isn't switched on yet. Add STAFF_PASSWORD in Vercel." } };
  if (!samePassword(b.password, process.env.STAFF_PASSWORD)) { await wait(800); return { status: 401, body: { error: "That password isn't right." } }; }
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId || !process.env.SQUARE_ACCESS_TOKEN) return { status: 503, body: { error: "The website isn't connected to Square yet." } };

  try {
    if (b.schedule === undefined) {
      const { perKm, maxKm } = require("./delivery").deliveryRules(null);
      return { status: 200, body: { schedule: await loadSchedule({ call, locationId, now }), defaults: { perKm, maxKm } } };
    }
    const schedule = normalize(b.schedule, now);
    const value = JSON.stringify(schedule);
    if (value.length > MAX_CHARS) return { status: 400, body: { error: "That's more days than can be saved at once. Try joining days next to each other into one stretch, or shortening the notes." } };
    const path = `/v2/locations/${encodeURIComponent(locationId)}/custom-attributes/${KEY}`;
    const upsert = () => call(path, { idempotency_key: crypto.randomUUID(), custom_attribute: { value } });
    try { await upsert(); }
    catch (err) {
      if (!(err && err.status === 404)) throw err;
      await createDefinition(call); // first save ever: make the attribute in Square, then save
      await upsert();
    }
    return { status: 200, body: { ok: true, schedule } };
  } catch (err) {
    console.error("website settings failed", err && err.errors ? JSON.stringify(err.errors) : err);
    return { status: 502, body: { error: "Square didn't save it. Please try again." } };
  }
}

module.exports = { adminSchedule, loadSchedule, dayStatus, normalize, todayInShop, KEY, EMPTY };
