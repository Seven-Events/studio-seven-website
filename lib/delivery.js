// Delivery price: one-way driving distance from the shop x the per-km rate, refused past the furthest distance.
// The rate and furthest distance come from /admin.html (saved in Square), or shop-settings.json.
//
// Distance:
// - With GOOGLE_MAPS_API_KEY set in Vercel, Google's Routes API (most reliable, needs a Google Cloud key).
// - Without it, free OpenStreetMap services: Nominatim finds the address, OSRM measures the drive.
const settings = require("../shop-settings.json");

class DeliveryError extends Error {
  constructor(message) { super(message); this.name = "DeliveryError"; this.status = 400; }
}

const UA = "StudioSevenWebsite/1.0 (flower delivery quotes)";
const cache = new Map(); // address -> { km, place }, for this server instance

/** The rate and furthest distance in force: saved at /admin.html, else shop-settings.json. */
function deliveryRules(schedule, opts = settings) {
  const d = opts.delivery || {};
  const s = schedule || {};
  return {
    perKm: Number.isInteger(s.r) ? s.r : d.perKm,
    maxKm: typeof s.mx === "number" ? s.mx : d.maxKm,
    from: d.from, lat: d.lat, lon: d.lon,
  };
}

function cleanAddress(raw) {
  const a = String(raw == null ? "" : raw).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  if (a.length < 5) throw new DeliveryError("Please add the delivery address.");
  return a;
}

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

async function googleKm(address, rules, fetchImpl) {
  const out = await getJson(fetchImpl, "https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "routes.distanceMeters" },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: rules.lat, longitude: rules.lon } } },
      destination: { address: /ontario|\bON\b/i.test(address) ? address : `${address}, Ontario, Canada` },
      travelMode: "DRIVE", regionCode: "ca", units: "METRIC",
    }),
  });
  const m = out && out.routes && out.routes[0] && out.routes[0].distanceMeters;
  if (!m) throw new DeliveryError("We couldn't find that address. Please check the street and town.");
  return { km: m / 1000, place: null };
}

async function osmKm(address, rules, fetchImpl) {
  const q = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "ca", addressdetails: "0", q: /ontario|\bON\b/i.test(address) ? address : `${address}, Ontario` });
  // Prefer matches near the shop when a town name exists in several places.
  q.set("viewbox", `${rules.lon - 1},${rules.lat + 0.7},${rules.lon + 1},${rules.lat - 0.7}`);
  const found = await getJson(fetchImpl, "https://nominatim.openstreetmap.org/search?" + q, { headers: { "User-Agent": UA, "Accept-Language": "en-CA" } });
  const hit = Array.isArray(found) && found[0];
  if (!hit) throw new DeliveryError("We couldn't find that address. Please check the street and town.");
  if (Number(hit.place_rank) < 26) throw new DeliveryError("Please add the street as well as the town, so we can work out the distance.");
  const route = await getJson(fetchImpl, `https://router.project-osrm.org/route/v1/driving/${rules.lon},${rules.lat};${Number(hit.lon)},${Number(hit.lat)}?overview=false`, { headers: { "User-Agent": UA } });
  const m = route && route.code === "Ok" && route.routes && route.routes[0] && route.routes[0].distance;
  if (!m && m !== 0) throw new Error("no route");
  return { km: m / 1000, place: String(hit.display_name || "").split(", ").slice(0, 4).join(", ") };
}

/** { km, fee, place } for an address, or throws a DeliveryError the customer can read. */
async function quoteDelivery(rawAddress, schedule, { fetch: fetchImpl = fetch } = {}) {
  const address = cleanAddress(rawAddress);
  const rules = deliveryRules(schedule);
  const key = address.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    try {
      hit = process.env.GOOGLE_MAPS_API_KEY ? await googleKm(address, rules, fetchImpl) : await osmKm(address, rules, fetchImpl);
    } catch (err) {
      if (err instanceof DeliveryError) throw err;
      console.error("delivery distance failed", err);
      throw new DeliveryError("We couldn't work out the delivery distance just now. Please try again in a moment, or call the shop.");
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, hit);
  }
  const km = Math.round(hit.km * 10) / 10;
  if (km > rules.maxKm) throw new DeliveryError(`Sorry, that's ${km} km away and we deliver up to ${rules.maxKm} km from the shop. You're welcome to choose pickup instead.`);
  return { km, fee: Math.round(km * rules.perKm), place: hit.place, perKm: rules.perKm, maxKm: rules.maxKm };
}

module.exports = { quoteDelivery, deliveryRules, DeliveryError };
