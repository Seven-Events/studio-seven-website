// Opening hours, for coffee pickup times. Staff set them at /admin.html (saved with the closed days, see
// lib/schedule.js). Until they do, the shop location's business hours in Square are used
// (Square Dashboard > Account & Settings > Business information > Locations > Business hours), then
// shop-settings.json "hours". If none are set, pickup times aren't limited by the clock (closed days still apply).
//
// Shape sent to the website: { 0: [[openMin, closeMin], ...], ..., 6: [...] }, minutes after midnight,
// shop time, 0 = Sunday. A day with no periods is a day the shop isn't open.
const { square } = require("./square");
const settings = require("../shop-settings.json");

const SHOP_TZ = "America/Toronto";
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/** Last coffee orders this many minutes before closing (shop-settings.json lastCoffeeMins, default 15). */
const LAST_ORDER = Number.isInteger(settings.lastCoffeeMins) ? settings.lastCoffeeMins : 15;

const toMins = (t) => {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Square's business_hours.periods (or the same shape from shop-settings.json) -> hours, or null when none are set. */
function parseHours(periods) {
  if (!Array.isArray(periods) || !periods.length) return null;
  const out = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const p of periods) {
    const wd = DAYS.indexOf(String((p && p.day_of_week) || "").toUpperCase().slice(0, 3));
    let a = toMins(p && p.start_local_time), b = toMins(p && p.end_local_time);
    if (wd < 0 || a === null || b === null) continue;
    if (b <= a) b = 24 * 60; // open past midnight: count it as open until midnight
    out[wd].push([a, b]);
  }
  if (!Object.values(out).some((l) => l.length)) return null;
  for (const k in out) out[k].sort((x, y) => x[0] - y[0]);
  return out;
}

/** Reads the hours from Square. If Square has none or doesn't answer, falls back to shop-settings.json (or null). */
async function loadHours({ call = square, locationId = process.env.SQUARE_LOCATION_ID } = {}) {
  let fromSquare = null;
  try {
    const got = await call(`/v2/locations/${encodeURIComponent(locationId)}`, undefined, "GET");
    const l = got && got.location;
    fromSquare = parseHours(l && l.business_hours && l.business_hours.periods);
  } catch (err) {
    console.error("opening hours didn't load", err && err.errors ? JSON.stringify(err.errors) : err);
  }
  return fromSquare || parseHours(settings.hours) || null;
}

/** Opening hours saved at /admin.html (schedule.h), in the same shape, or null when none are saved. */
function hoursFromSchedule(sched) {
  const h = sched && sched.h;
  if (!Array.isArray(h) || !h.some(Boolean)) return null;
  const out = {};
  for (let i = 0; i < 7; i++) out[i] = h[i] ? [[h[i][0], h[i][1]]] : [];
  return out;
}

/** The shop's weekday and minutes after midnight at a moment. */
function shopClock(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: SHOP_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  return { wd: DAYS.indexOf(parts.weekday.toUpperCase()), mins: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Whether coffee can be ready at this moment: open, and at least LAST_ORDER minutes before closing. No hours = always. */
function coffeeOpenAt(hours, at) {
  if (!hours) return true;
  const { wd, mins } = shopClock(at);
  return (hours[wd] || []).some(([a, b]) => mins >= a && mins <= b - LAST_ORDER);
}

module.exports = { parseHours, loadHours, hoursFromSchedule, coffeeOpenAt, shopClock, LAST_ORDER };
