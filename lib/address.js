// Address suggestions as customers type their delivery address, from Photon (free, OpenStreetMap-based,
// made for search-as-you-type). Results are limited to Canada near the shop, nearest first.
const settings = require("../shop-settings.json");

const UA = "StudioSevenWebsite/1.0 (address suggestions)";

function label(p) {
  const street = [p.housenumber, p.street || (p.type === "street" ? p.name : "")].filter(Boolean).join(" ") || p.name || "";
  const town = p.district || p.locality || p.city || p.county || "";
  const prov = p.state === "Ontario" ? "ON" : p.state || "";
  return [street, town, [prov, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** POST /api/address { q } -> { suggestions: [{ label }] } */
async function suggestAddresses(body, { fetch: fetchImpl = fetch } = {}) {
  const q = String((body && body.q) || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
  if (q.length < 3) return { status: 200, body: { suggestions: [] } };
  const d = settings.delivery || {};
  const params = new URLSearchParams({ q, lat: String(d.lat), lon: String(d.lon), limit: "8", lang: "en",
    bbox: [d.lon - 1, d.lat - 0.7, d.lon + 1, d.lat + 0.7].join(",") });
  try {
    const res = await fetchImpl("https://photon.komoot.io/api/?" + params, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error("photon " + res.status);
    const data = await res.json();
    const seen = new Set(), suggestions = [];
    for (const f of (data && data.features) || []) {
      const p = f.properties || {};
      if (p.countrycode !== "CA" || !(p.street || p.type === "street")) continue; // street-level only
      const l = label(p);
      if (!l || seen.has(l)) continue;
      seen.add(l); suggestions.push({ label: l });
      if (suggestions.length >= 5) break;
    }
    return { status: 200, body: { suggestions } };
  } catch (err) {
    console.error("address suggestions failed", err);
    return { status: 200, body: { suggestions: [] } }; // typing still works without suggestions
  }
}

module.exports = { suggestAddresses, label };
