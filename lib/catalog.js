// Builds the website menu from the shop's Square Item Library.
// Staff edit items, prices, photos, modifiers (milk, add-ons) and stock in Square;
// shop-settings.json only says which Square categories show on the site, and in what order.
const settings = require("../shop-settings.json");
const { square } = require("./square");

const low = (s) => String(s || "").trim().toLowerCase();

function presentAt(obj, locationId) {
  if (!obj || obj.is_deleted) return false;
  if (obj.present_at_all_locations === false) return (obj.present_at_location_ids || []).includes(locationId);
  return !(obj.absent_at_location_ids || []).includes(locationId);
}

function itemCategoryIds(d) {
  const ids = (d.categories || []).map((c) => [c.id, c.ordinal]);
  if (d.category_id && !ids.some(([id]) => id === d.category_id)) ids.push([d.category_id, undefined]);
  if (d.reporting_category && d.reporting_category.id && !ids.some(([id]) => id === d.reporting_category.id)) ids.push([d.reporting_category.id, d.reporting_category.ordinal]);
  return ids;
}

/**
 * Pure: Square catalog objects + inventory counts -> the menu the website shows and the server checks orders against.
 * Item shape: { id, kind, n, d, img, tag, v:[{id,n,p,out}], mods:[{id,n,multi,req,max,o:[{id,n,d,def}]}], out }
 */
function buildMenu(objects, counts, locationId, opts = settings) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const stock = new Map((counts || []).map((c) => [c.catalog_object_id, Number(c.quantity)]));
  const catName = new Map(objects.filter((o) => o.type === "CATEGORY").map((o) => [o.id, (o.category_data && o.category_data.name) || ""]));
  const coffeeCats = opts.coffeeCategories.map((n) => ({ name: n, items: [] }));
  const flowerKeys = new Set(opts.flowerCategories.map(low));
  const flowers = [];
  const currency = "CAD";

  for (const o of objects) {
    if (o.type !== "ITEM" || !presentAt(o, locationId)) continue;
    const d = o.item_data || {};
    if (d.is_archived || d.ecom_visibility === "HIDDEN") continue;

    // Which website section is it in?
    let kind = null, cat = null, ord = 1e9;
    for (const [cid, ordinal] of itemCategoryIds(d)) {
      const name = low(catName.get(cid));
      if (flowerKeys.has(name)) { kind = "flowers"; ord = ordinal ?? ord; break; }
      const c = coffeeCats.find((x) => low(x.name) === name);
      if (c) { kind = "coffee"; cat = c; ord = ordinal ?? ord; break; }
    }
    if (!kind) continue; // not in a website category: in-store only

    const v = (d.variations || []).filter((x) => presentAt(x, locationId)).map((x) => {
      const vd = x.item_variation_data || {};
      if (vd.pricing_type === "VARIABLE_PRICING" || !vd.price_money || vd.sellable === false) return null;
      const ov = (vd.location_overrides || []).find((l) => l.location_id === locationId) || {};
      const tracked = ov.track_inventory ?? vd.track_inventory ?? false;
      const out = !!ov.sold_out || (tracked && !((stock.get(x.id) || 0) > 0));
      return { id: x.id, n: vd.name || "Regular", p: Number(vd.price_money.amount), out, ord: vd.ordinal ?? 0 };
    }).filter(Boolean).sort((a, b) => a.ord - b.ord).map(({ ord: _o, ...rest }) => rest);
    if (!v.length) continue;

    const mods = (d.modifier_list_info || []).filter((m) => m.enabled !== false).map((info) => {
      const list = byId.get(info.modifier_list_id);
      if (!list || list.is_deleted || !presentAt(list, locationId)) return null;
      const ld = list.modifier_list_data || {};
      const overrides = new Map((info.modifier_overrides || []).map((x) => [x.modifier_id, x]));
      const o = (ld.modifiers || []).filter((m) => presentAt(m, locationId)).map((m) => {
        const md = m.modifier_data || {};
        const ovr = overrides.get(m.id) || {};
        return { id: m.id, n: md.name || "", d: Number((md.price_money && md.price_money.amount) || 0), def: !!(ovr.on_by_default ?? md.on_by_default), ord: md.ordinal ?? 0 };
      }).sort((a, b) => a.ord - b.ord).map(({ ord: _o, ...rest }) => rest);
      if (!o.length) return null;
      const multi = ld.selection_type === "MULTIPLE";
      const min = Number(info.min_selected_modifiers ?? ld.min_selected_modifiers ?? -1);
      const max = Number(info.max_selected_modifiers ?? ld.max_selected_modifiers ?? -1);
      return { id: list.id, n: ld.name || "Options", multi, req: min >= 1, max: multi ? (max > 0 ? max : o.length) : 1, o };
    }).filter(Boolean);

    const img = (d.image_ids || []).map((id) => byId.get(id)).find((x) => x && x.image_data && x.image_data.url);
    const item = {
      id: o.id, kind, n: d.name || "", d: d.description_plaintext || d.description || "",
      img: img ? img.image_data.url : null, tag: opts.tags[d.name] || null,
      v, mods, out: v.every((x) => x.out), ord,
    };
    (kind === "flowers" ? flowers : cat.items).push(item);
  }

  const sortItems = (list) => list.sort((a, b) => a.ord - b.ord || a.n.localeCompare(b.n)).forEach((i) => delete i.ord);
  coffeeCats.forEach((c) => sortItems(c.items));
  sortItems(flowers);

  return {
    currency, taxPercent: opts.taxPercent, deliveryFee: opts.deliveryFee,
    coffee: { categories: coffeeCats.filter((c) => c.items.length) },
    flowers: { occasions: opts.occasions, preorderMinDays: opts.preorderMinDays, preorderMaxDays: opts.preorderMaxDays, items: flowers },
  };
}

/** Reads the whole Item Library and stock counts for the shop location from Square. */
async function loadMenu({ call = square, locationId = process.env.SQUARE_LOCATION_ID } = {}) {
  const objects = [];
  let cursor;
  do {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY,MODIFIER_LIST,IMAGE" });
    if (cursor) q.set("cursor", cursor);
    const page = await call("/v2/catalog/list?" + q, undefined, "GET");
    objects.push(...(page.objects || []));
    cursor = page.cursor;
  } while (cursor);

  const tracked = [];
  for (const o of objects) {
    if (o.type !== "ITEM") continue;
    for (const v of (o.item_data && o.item_data.variations) || []) {
      const vd = v.item_variation_data || {};
      const ov = (vd.location_overrides || []).find((l) => l.location_id === locationId) || {};
      if (ov.track_inventory ?? vd.track_inventory) tracked.push(v.id);
    }
  }
  const counts = [];
  for (let i = 0; i < tracked.length; i += 500) {
    let c;
    do {
      const page = await call("/v2/inventory/counts/batch-retrieve", { catalog_object_ids: tracked.slice(i, i + 500), location_ids: [locationId], states: ["IN_STOCK"], cursor: c });
      counts.push(...(page.counts || []));
      c = page.cursor;
    } while (c);
  }
  return buildMenu(objects, counts, locationId);
}

/** Finds an item by id in a built menu. */
function findItem(menu, id) {
  for (const c of menu.coffee.categories) { const i = c.items.find((x) => x.id === id); if (i) return i; }
  return menu.flowers.items.find((x) => x.id === id) || null;
}

module.exports = { buildMenu, loadMenu, findItem, settings };
