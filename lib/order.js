// Turns a cart from the website into a Square order.
// Every price comes from public/menu.json on the server. The browser only sends
// item ids and option choices, so nobody can change a price by editing the page.

const SHOP_TZ = "America/Toronto";

class OrderError extends Error {
  constructor(message) { super(message); this.name = "OrderError"; this.status = 400; }
}

const isInt = (v) => Number.isInteger(v);
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

function pick(list, i, what) {
  if (i === undefined || i === null) return null;
  if (!isInt(i) || i < 0 || i >= list.length) throw new OrderError(`That ${what} isn't on the menu any more. Please refresh and try again.`);
  return list[i];
}

// "2027-05-14" -> Date at 10:00 shop time on that day
function shopDateAt(dateStr, hour) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) throw new OrderError("Please pick a valid date.");
  const guess = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: SHOP_TZ, timeZoneName: "longOffset" })
    .formatToParts(guess).find((p) => p.type === "timeZoneName").value; // e.g. "GMT-04:00"
  const m = off.match(/GMT([+-])(\d{2}):(\d{2})/);
  const sign = m ? (m[1] === "-" ? -1 : 1) : 0;
  const mins = m ? sign * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(guess.getTime() - mins * 60000);
}

function shopDayDiff(dateStr, now) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: SHOP_TZ }).format(now); // YYYY-MM-DD
  return Math.round((Date.parse(dateStr) - Date.parse(today)) / 86400000);
}

function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  if (ten.length !== 10) throw new OrderError("Please enter a 10-digit mobile number so we can text you.");
  return "+1" + ten;
}

/** Price each cart line from the menu. Returns Square line items plus facts about the cart. */
function priceCart(cart, menu, now = new Date()) {
  if (!Array.isArray(cart) || cart.length === 0) throw new OrderError("Your order is empty.");
  if (cart.length > 30) throw new OrderError("That's a big order! Please call the shop for orders over 30 items.");
  const coffeeItems = menu.coffee.categories.flatMap((c) => c.items);
  const C = menu.coffee, F = menu.flowers;
  const lines = [];
  const preorderDates = [];
  let hasCoffee = false, hasFlowers = false;

  for (const l of cart) {
    const q = l && l.q;
    if (!isInt(q) || q < 1 || q > 20) throw new OrderError("Each item can be ordered 1 to 20 at a time.");

    if (l.kind === "coffee") {
      const item = coffeeItems.find((x) => x.id === l.id);
      if (!item) throw new OrderError("One of your drinks isn't on the menu any more. Please refresh and try again.");
      hasCoffee = true;
      const hasSize = item.sz !== false && !item.bake;
      const hasMilk = item.milk !== false && !item.bake;
      let unit = item.p;
      const opts = [];
      if (hasSize) { const s = pick(C.sizes, l.size ?? C.defaultSize, "size"); unit += s.d; opts.push(s.n); }
      if (hasMilk) { const m = pick(C.milks, l.milk ?? 0, "milk"); unit += m.d; opts.push(m.n === "No milk" ? m.n : m.n + " milk"); }
      const adds = Array.isArray(l.adds) && !item.bake ? [...new Set(l.adds)] : [];
      for (const a of adds) { const add = pick(C.adds, a, "add-on"); unit += add.d; opts.push(add.n); }
      const note = item.bake ? "" : clean(l.note, 140);
      lines.push({ name: item.n, quantity: String(q), variation_name: opts.join(", ") || undefined, note: note || undefined, base_price_money: { amount: unit, currency: menu.currency } });
    } else if (l.kind === "flowers") {
      const item = F.items.find((x) => x.id === l.id);
      if (!item) throw new OrderError("One of your flower items isn't available any more. Please refresh and try again.");
      hasFlowers = true;
      const size = pick(item.sizes, l.size ?? 0, "size");
      const occasion = pick(F.occasions, l.occasion ?? 0, "occasion");
      const notes = [`For: ${occasion}`];
      if (l.preorderDate) {
        const diff = shopDayDiff(l.preorderDate, now);
        if (!(diff >= F.preorderMinDays && diff <= F.preorderMaxDays)) throw new OrderError(`Pre-orders can be ${F.preorderMinDays} to ${F.preorderMaxDays} days ahead. Please pick another date.`);
        preorderDates.push(l.preorderDate);
        notes.unshift(`PRE-ORDER for ${l.preorderDate}`);
      }
      const card = clean(l.card, 200);
      if (card) notes.push(`Card: "${card}"`);
      lines.push({ name: item.n, quantity: String(q), variation_name: size.n, note: notes.join(" | "), base_price_money: { amount: item.p + size.d, currency: menu.currency } });
    } else {
      throw new OrderError("Something in your order wasn't recognised. Please refresh and try again.");
    }
  }
  preorderDates.sort();
  return { lines, hasCoffee, hasFlowers, preorderDates };
}

/** Build the body for Square's CreateOrder call. */
function buildSquareOrder({ cart, customer, fulfillment, menu, locationId, now = new Date() }) {
  const priced = priceCart(cart, menu, now);
  const name = clean(customer && customer.name, 80);
  if (!name) throw new OrderError("Please add your name so we know whose order it is.");
  const phone = normalizePhone(customer && customer.phone);
  const f = fulfillment || {};
  const deliver = priced.hasFlowers && f.flowers === "delivery";
  if (deliver && priced.hasCoffee) throw new OrderError("Coffee is pickup only. Please place your coffee as a separate order.");

  const recipient = { display_name: name, phone_number: phone };
  let ful;
  if (deliver) {
    const address = clean(f.address, 160);
    if (address.length < 5) throw new OrderError("Please add the delivery address.");
    const d = { recipient: { ...recipient, address: { address_line_1: address, administrative_district_level_1: "ON", country: "CA" } } };
    if (priced.preorderDates.length) { d.schedule_type = "SCHEDULED"; d.deliver_at = shopDateAt(priced.preorderDates[0], 12).toISOString(); }
    else { d.schedule_type = "ASAP"; d.prep_time_duration = "PT3H"; }
    ful = { type: "DELIVERY", state: "PROPOSED", delivery_details: d };
  } else {
    const p = { recipient };
    if (priced.hasCoffee) {
      if (!f.coffeeTime || f.coffeeTime === "asap") { p.schedule_type = "ASAP"; p.prep_time_duration = "PT10M"; }
      else {
        const t = new Date(f.coffeeTime);
        const mins = (t - now) / 60000;
        if (isNaN(mins) || mins < 5 || mins > 240) throw new OrderError("Please pick a pickup time within the next 4 hours.");
        p.schedule_type = "SCHEDULED"; p.pickup_at = t.toISOString();
      }
    } else if (priced.preorderDates.length) {
      p.schedule_type = "SCHEDULED"; p.pickup_at = shopDateAt(priced.preorderDates[0], 10).toISOString();
    } else {
      p.schedule_type = "ASAP"; p.prep_time_duration = "PT2H";
    }
    if (priced.hasCoffee && priced.hasFlowers) p.note = "Includes flowers. Check each flower line for its date.";
    ful = { type: "PICKUP", state: "PROPOSED", pickup_details: p };
  }

  const order = {
    location_id: locationId,
    source: { name: "studio-seven-website" },
    line_items: priced.lines,
    taxes: [{ uid: "hst", name: "HST", percentage: menu.taxPercent, scope: "ORDER" }],
    fulfillments: [ful],
  };
  if (deliver) {
    order.service_charges = [{ name: "Flower delivery", amount_money: { amount: menu.deliveryFee, currency: menu.currency }, calculation_phase: "SUBTOTAL_PHASE", taxable: true }];
  }
  return order;
}

module.exports = { OrderError, priceCart, buildSquareOrder, normalizePhone, shopDateAt };
