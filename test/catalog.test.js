const test = require("node:test");
const assert = require("node:assert");
const fx = require("./fixtures/square-catalog.json");
const { buildMenu, loadMenu } = require("../lib/catalog");

const clone = () => JSON.parse(JSON.stringify(fx.objects));

test("groups Square items into the website's coffee categories and flowers, in Square's order", () => {
  const m = buildMenu(fx.objects, fx.counts, "L1");
  assert.deepEqual(m.coffee.categories.map((c) => c.name), ["Espresso", "House drinks", "No coffee"]);
  assert.deepEqual(m.coffee.categories[0].items.map((i) => i.n), ["Espresso", "Americano", "Cortado", "Latte", "Cappuccino", "Mocha"]);
  assert.equal(m.flowers.items[0].n, "Market Bunch");
  assert.equal(m.flowers.items[0].img, "/img/sprig.webp");
  assert.equal(m.flowers.items[0].tag, "Bestseller");
  assert.ok(!JSON.stringify(m).includes("Mug")); // in-store only
  assert.ok(!JSON.stringify(m).includes("Croissant")); // Baking isn't a website category
});

test("modifier lists become choices, with Square's defaults and required flag", () => {
  const latte = buildMenu(fx.objects, fx.counts, "L1").coffee.categories[0].items.find((i) => i.n === "Latte");
  assert.deepEqual(latte.v.map((v) => [v.n, v.p]), [["8 oz", 525], ["12 oz", 585], ["16 oz", 635]]);
  const [milk, adds] = latte.mods;
  assert.equal(milk.req, true); assert.equal(milk.multi, false); assert.equal(milk.o[0].def, true);
  assert.equal(adds.multi, true); assert.equal(adds.max, 4);
});

test("tracked stock at zero, or marked sold out in Square, shows as sold out", () => {
  const objs = clone();
  const bud = objs.find((o) => o.id === "I_bud");
  bud.item_data.variations[0].item_variation_data.location_overrides = [{ location_id: "L1", sold_out: true }];
  const m = buildMenu(objs, [], "L1");
  const dried = m.flowers.items.find((i) => i.n === "Dried Wreath");
  assert.equal(dried.v[0].out, true); // tracked, no count
  assert.equal(m.flowers.items.find((i) => i.n === "Bud Vase Trio").out, true);
});

test("archived, hidden-online, deleted or other-location items are left off", () => {
  const objs = clone();
  objs.find((o) => o.id === "I_esp").item_data.is_archived = true;
  objs.find((o) => o.id === "I_amer").item_data.ecom_visibility = "HIDDEN";
  objs.find((o) => o.id === "I_cort").is_deleted = true;
  Object.assign(objs.find((o) => o.id === "I_latte"), { present_at_all_locations: false, present_at_location_ids: ["L2"] });
  const names = buildMenu(objs, [], "L1").coffee.categories[0].items.map((i) => i.n);
  assert.deepEqual(names, ["Cappuccino", "Mocha"]);
});

test("loadMenu pages through the catalog and asks Square for stock of tracked items only", async () => {
  const calls = [];
  const half = Math.floor(fx.objects.length / 2);
  const call = async (path, body) => {
    calls.push([path, body]);
    if (path.startsWith("/v2/catalog/list")) return path.includes("cursor=") ? { objects: fx.objects.slice(half) } : { objects: fx.objects.slice(0, half), cursor: "c2" };
    return { counts: fx.counts };
  };
  const m = await loadMenu({ call, locationId: "L1" });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2][1].catalog_object_ids, ["V_dried_0", "V_dried_1"]);
  assert.equal(m.flowers.items.length, 6);
});
