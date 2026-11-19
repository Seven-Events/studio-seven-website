const test = require("node:test");
const assert = require("node:assert");
const { saveFocus, focusFromSquare } = require("../lib/focus");
const { buildMenu } = require("../lib/catalog");
const fx = require("./fixtures/square-catalog.json");

const env = (vars) => { const old = {}; for (const k in vars) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } return () => env(old); };
const noWait = async () => {};
const item = () => ({ type: "ITEM", id: "I_wrap", version: 5, item_data: { name: "Holiday Wrap", variations: [{ id: "V1" }] } });

function fakeSquare({ hasDefinition = false, mismatchOnce = false } = {}) {
  const calls = []; let mismatched = false;
  const call = async (path, body, method) => {
    calls.push([path, body, method]);
    if (path === "/v2/catalog/search") return { objects: hasDefinition ? [{ custom_attribute_definition_data: { key: "photo_focus" } }] : [] };
    if (path.startsWith("/v2/catalog/object/")) return { object: item() };
    if (path === "/v2/catalog/object" && body.object.type === "ITEM" && mismatchOnce && !mismatched) {
      mismatched = true; const e = new Error("x"); e.errors = [{ code: "VERSION_MISMATCH" }]; throw e;
    }
    return {};
  };
  return { call, calls };
}

test("saves the focus spot on the Square item, creating the Photo focus attribute the first time", async () => {
  const restore = env({ STAFF_PASSWORD: "roses" });
  const sq = fakeSquare();
  const res = await saveFocus({ password: "roses", itemId: "I_wrap", focus: "62% 45%" }, { square: sq.call, wait: noWait });
  restore();
  assert.equal(res.status, 200);
  const def = sq.calls.find((c) => c[0] === "/v2/catalog/object" && c[1].object.type === "CUSTOM_ATTRIBUTE_DEFINITION");
  assert.equal(def[1].object.custom_attribute_definition_data.key, "photo_focus");
  const up = sq.calls.find((c) => c[0] === "/v2/catalog/object" && c[1].object.type === "ITEM");
  assert.deepEqual(up[1].object.custom_attribute_values.photo_focus, { string_value: "62% 45%" });
  assert.equal(up[1].object.item_data.name, "Holiday Wrap"); // the rest of the item is sent back unchanged
});

test("does not recreate the attribute once it exists, and retries once if the item changed meanwhile", async () => {
  const restore = env({ STAFF_PASSWORD: "roses" });
  const sq = fakeSquare({ hasDefinition: true, mismatchOnce: true });
  const res = await saveFocus({ password: "roses", itemId: "I_wrap", focus: "10% 90%" }, { square: sq.call, wait: noWait });
  restore();
  assert.equal(res.status, 200);
  assert.ok(!sq.calls.some((c) => c[1] && c[1].object && c[1].object.type === "CUSTOM_ATTRIBUTE_DEFINITION"));
  assert.equal(sq.calls.filter((c) => c[0] === "/v2/catalog/object").length, 2);
});

test("wrong or missing password, missing setup and bad values save nothing", async () => {
  const sq = fakeSquare();
  let restore = env({ STAFF_PASSWORD: undefined });
  assert.equal((await saveFocus({ password: "x", itemId: "I", focus: "1% 1%" }, { square: sq.call, wait: noWait })).status, 503);
  restore();
  restore = env({ STAFF_PASSWORD: "roses" });
  assert.equal((await saveFocus({ password: "nope", itemId: "I", focus: "1% 1%" }, { square: sq.call, wait: noWait })).status, 401);
  assert.equal((await saveFocus({ password: "roses", itemId: "I", focus: "150% 1%" }, { square: sq.call, wait: noWait })).status, 400);
  assert.equal((await saveFocus({ password: "roses", itemId: "../x", focus: "1% 1%" }, { square: sq.call, wait: noWait })).status, 400);
  restore();
  assert.equal(sq.calls.length, 0);
});

test("the menu uses a focus saved in Square ahead of shop-settings.json", () => {
  assert.equal(focusFromSquare({ custom_attribute_values: { photo_focus: { string_value: "20% 30%" } } }), "20% 30%");
  assert.equal(focusFromSquare({ custom_attribute_values: { "sq0idp-abc:photo_focus": { string_value: "5% 5%" } } }), "5% 5%");
  assert.equal(focusFromSquare({ custom_attribute_values: { photo_focus: { string_value: "middle" } } }), null);
  const objs = JSON.parse(JSON.stringify(fx.objects));
  const bunch = objs.find((o) => o.type === "ITEM" && o.item_data.name === "Market Bunch");
  bunch.custom_attribute_values = { photo_focus: { string_value: "33% 66%" } };
  const settings = require("../shop-settings.json");
  const m = buildMenu(objs, fx.counts, "L1", { ...settings, focus: { "Market Bunch": "90% 90%" } });
  assert.equal(m.flowers.items.find((i) => i.n === "Market Bunch").focus, "33% 66%");
});
