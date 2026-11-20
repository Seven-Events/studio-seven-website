const test = require("node:test");
const assert = require("node:assert");
const { suggestAddresses, label } = require("../lib/address");

const feature = (p) => ({ properties: { countrycode: "CA", state: "Ontario", ...p } });

test("suggests street-level Canadian addresses near the shop, in a short readable form", async () => {
  let url;
  const fake = async (u) => { url = u; return { ok: true, json: async () => ({ features: [
    feature({ housenumber: "12", street: "Kent Street West", district: "Lindsay", city: "Kawartha Lakes", postcode: "K9V 2Y1" }),
    feature({ housenumber: "12", street: "Kent Street West", district: "Lindsay", city: "Kawartha Lakes", postcode: "K9V 2Y1" }), // duplicate
    feature({ name: "Lindsay", type: "city" }), // a town alone isn't enough to deliver to
    { properties: { countrycode: "US", street: "Kent St", housenumber: "12" } },
    feature({ name: "Sturgeon Road", type: "street", city: "Kawartha Lakes", district: "Omemee" }),
  ] }) }; };
  const res = await suggestAddresses({ q: "12 kent st" }, { fetch: fake });
  assert.deepEqual(res.body.suggestions.map((s) => s.label), ["12 Kent Street West, Lindsay, ON K9V 2Y1", "Sturgeon Road, Omemee, ON"]);
  assert.match(url, /photon\.komoot\.io\/api\/\?q=12\+kent\+st&lat=44\.3003656&lon=-78\.5545074/);
  assert.match(url, /bbox=/);
});

test("short input asks nothing, and a failing service just gives no suggestions", async () => {
  let called = false;
  assert.deepEqual((await suggestAddresses({ q: "12" }, { fetch: async () => { called = true; } })).body.suggestions, []);
  assert.equal(called, false);
  const down = await suggestAddresses({ q: "12 kent" }, { fetch: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual([down.status, down.body.suggestions], [200, []]);
  assert.equal(label({ housenumber: "5", street: "King St E", city: "Kawartha Lakes", state: "Ontario" }), "5 King St E, Kawartha Lakes, ON");
});
