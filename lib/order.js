// Turns a cart from the website into a Square order.
// The browser only sends Square catalog ids and choices. Each line is checked against the
// live Square menu, and Square prices the order from its own Item Library, so nobody can
// change a price by editing the page.

const { findItem } = require("./catalog");
const { dayStatus, todayInShop } = require("./schedule");
const { coffeeOpenAt } = require("./hours");
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

/** Check each cart line against the Square menu. Returns Square line items plus facts about the cart.
 *  Lines point at Square catalog ids, so Square prices them itself and counts down stock. */
function priceCart(cart, menu, now = new Date()) {
  if (!Array.isArray(cart) || cart.length === 0) throw new OrderError("Your order is empty.");
  if (cart.length > 30) throw new OrderError("That's a big order! Please call the shop for orders over 30 items.");
  const F = menu.flowers;
  const lines = [];
  let hasCoffee = false, hasFlowers = false, hasChristmas = false;

  for (const l of cart) {
    const q = l && l.q;
    if (!isInt(q) || q < 1 || q > 20) throw new OrderError("Each item can be ordered 1 to 20 at a time.");
    const item = typeof l.id === "string" ? findItem(menu, l.id) : null;
    if (!item) throw new OrderError("Something in your order isn't on the menu any more. Please refresh and try again.");
    const v = item.v.find((x) => x.id === l.v) || (l.v == null && item.v.length === 1 ? item.v[0] : null);
    if (!v) throw new OrderError(`Please pick a size for the ${item.n}. Refresh and try again.`);
    if (v.out) throw new OrderError(`Sorry, the ${item.n}${item.v.length > 1 ? ` (${v.n})` : ""} just sold out. Please remove it and try again.`);

    // Modifiers (milk, add-ons and so on), checked against the item's own lists in Square.
    const chosen = Array.isArray(l.mods) ? [...new Set(l.mods)] : [];
    const modifiers = [];
    let unit = v.p;
    for (const list of item.mods) {
      const picks = list.o.filter((o) => chosen.includes(o.id));
      if (list.req && picks.length === 0) throw new OrderError(`Please choose ${list.n.toLowerCase()} for the ${item.n}.`);
      if (picks.length > list.max) throw new OrderError(`Too many ${list.n.toLowerCase()} choices for the ${item.n}.`);
      for (const o of picks) { modifiers.push({ catalog_object_id: o.id, quantity: "1" }); unit += o.d; }
    }
    if (modifiers.length !== chosen.length) throw new OrderError(`One of the options for the ${item.n} isn't available any more. Please refresh and try again.`);

    const line = { catalog_object_id: v.id, quantity: String(q), modifiers: modifiers.length ? modifiers : undefined };
    if (item.kind === "coffee") {
      hasCoffee = true;
      const note = clean(l.note, 140);
      if (note) line.note = note;
    } else {
      hasFlowers = true;
      if (item.xmas) hasChristmas = true;
      const occasion = pick(F.occasions, l.occasion ?? 0, "occasion");
      const notes = [`For: ${occasion}`];
      const card = clean(l.card, 200);
      if (card) notes.push(`Card: "${card}"`);
      line.note = notes.join(" | ");
    }
    line._unit = unit; // the website's own estimate, for tests; stripped before sending to Square
    line._flower = item.kind === "flowers" && (item.xmas && F.christmas ? "CHRISTMAS PRE-ORDER" : "PRE-ORDER"); // label for the staff note
    lines.push(line);
  }
  return { lines, hasCoffee, hasFlowers, hasChristmas };
}

/** Christmas days still taking orders, from shop-settings.json (empty when none are set or all have closed). */
function openChristmasDates(menu, now = new Date()) {
  const x = menu.flowers.christmas;
  if (!x) return [];
  return x.dates.filter((d) => shopDayDiff(d, now) >= x.orderAheadDays);
}

/** The pickup or delivery day the customer chose at checkout for their flowers, checked. null = soonest. */
function flowerDate(raw, priced, menu, now) {
  const F = menu.flowers;
  const date = raw ? String(raw) : null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OrderError("Please pick a valid date.");
  if (priced.hasChristmas && F.christmas) {
    const open = openChristmasDates(menu, now);
    if (!open.length) throw new OrderError("Christmas orders are closed. Please call the shop and we'll see what we can do.");
    if (!date) throw new OrderError("Please choose your Christmas pickup or delivery day.");
    if (!open.includes(date)) throw new OrderError("That Christmas day isn't available any more. Please pick another day.");
  } else if (date) {
    const diff = shopDayDiff(date, now);
    if (!(diff >= F.preorderMinDays && diff <= F.preorderMaxDays)) throw new OrderError(`Pre-orders can be ${F.preorderMinDays} to ${F.preorderMaxDays} days ahead. Please pick another date.`);
  }
  if (date && priced.hasCoffee) throw new OrderError("Coffee is made for today. Please place your pre-ordered flowers as a separate order.");
  return date;
}

const prettyDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** Refuses closed days (set at /admin.html), and delivery on no-delivery days. date null = today, as soon as possible. */
function checkOpen(schedule, date, deliver, hasCoffee, now) {
  if (!schedule) return;
  const st = dayStatus(schedule, date || todayInShop(now));
  const why = st.note ? ` (${st.note})` : "";
  if (st.closed) {
    if (date) throw new OrderError(`Sorry, we're closed on ${prettyDay(date)}${why}. Please pick another day.`);
    if (hasCoffee) throw new OrderError(`Sorry, we're closed today${why}, so we can't make coffee orders. See you when we're back!`);
    throw new OrderError(`Sorry, we're closed today${why}. Please pick a day for your flowers.`);
  }
  if (deliver && st.noDelivery) {
    if (date) throw new OrderError(`Sorry, we're not delivering on ${prettyDay(date)}${why}. Please pick another day, or choose pickup.`);
    throw new OrderError(`Sorry, we're not delivering today${why}. Please pick a day, or choose pickup.`);
  }
  if (!deliver && st.noPickup) {
    if (date) throw new OrderError(`Sorry, the shop is closed on ${prettyDay(date)}, so there's no pickup that day. Please pick another day, or choose delivery.`);
    if (hasCoffee) throw new OrderError("Sorry, the shop is closed today, so we can't make coffee orders. See you when we're open!");
    throw new OrderError("Sorry, the shop is closed today. Please pick a day, or choose delivery.");
  }
}

/** Build the body for Square's CreateOrder call. */
/** delivery = { km, fee } from lib/delivery.js, worked out from the address before this is called. */
function buildSquareOrder({ cart, customer, fulfillment, menu, locationId, delivery, now = new Date() }) {
  const priced = priceCart(cart, menu, now);
  const name = clean(customer && customer.name, 80);
  if (!name) throw new OrderError("Please add your name so we know whose order it is.");
  const phone = normalizePhone(customer && customer.phone);
  const f = fulfillment || {};
  const deliver = priced.hasFlowers && f.flowers === "delivery";
  if (deliver && priced.hasCoffee) throw new OrderError("Coffee is pickup only. Please place your coffee as a separate order.");
  // One date per order, because a Square order holds one pickup or delivery.
  const date = priced.hasFlowers ? flowerDate(f.date, priced, menu, now) : null;
  if (date) for (const l of priced.lines) if (l._flower) l.note = `${l._flower} for ${date} | ${l.note}`;
  checkOpen(menu.schedule, date, deliver, priced.hasCoffee, now);

  const recipient = { display_name: name, phone_number: phone };
  let ful;
  if (deliver) {
    const address = clean(f.address, 160);
    if (address.length < 5) throw new OrderError("Please add the delivery address.");
    if (!delivery || !Number.isInteger(delivery.fee)) throw new OrderError("Please check the delivery address so we can work out the delivery cost.");
    const d = { recipient: { ...recipient, address: { address_line_1: address, administrative_district_level_1: "ON", country: "CA" } } };
    if (date) { d.schedule_type = "SCHEDULED"; d.deliver_at = shopDateAt(date, 12).toISOString(); }
    else { d.schedule_type = "ASAP"; d.prep_time_duration = "PT3H"; }
    d.note = `${delivery.km} km from the shop`;
    ful = { type: "DELIVERY", state: "PROPOSED", delivery_details: d };
  } else {
    const p = { recipient };
    if (priced.hasCoffee) {
      if (!f.coffeeTime || f.coffeeTime === "asap") {
        if (!coffeeOpenAt(menu.hours, now)) throw new OrderError("Sorry, we're not taking coffee orders right now because the shop is closed. Please pick a time when we're open.");
        p.schedule_type = "ASAP"; p.prep_time_duration = "PT10M";
      } else {
        const t = new Date(f.coffeeTime);
        const mins = (t - now) / 60000;
        if (isNaN(mins) || mins < 5 || mins > 240) throw new OrderError("Please pick a pickup time within the next 4 hours.");
        if (!coffeeOpenAt(menu.hours, t)) throw new OrderError("Sorry, we're closed at that time. Please pick another pickup time.");
        p.schedule_type = "SCHEDULED"; p.pickup_at = t.toISOString();
      }
    } else if (date) {
      p.schedule_type = "SCHEDULED"; p.pickup_at = shopDateAt(date, 10).toISOString();
    } else {
      p.schedule_type = "ASAP"; p.prep_time_duration = "PT2H";
    }
    if (priced.hasCoffee && priced.hasFlowers) p.note = "Includes flowers, picked up with the coffee.";
    ful = { type: "PICKUP", state: "PROPOSED", pickup_details: p };
  }

  const order = {
    location_id: locationId,
    source: { name: "studio-seven-website" },
    line_items: priced.lines.map(({ _unit, _flower, ...line }) => line),
    taxes: [{ uid: "hst", name: "HST", percentage: String(menu.taxPercent), scope: "ORDER" }],
    fulfillments: [ful],
  };
  if (deliver) {
    order.service_charges = [{ name: `Flower delivery (${delivery.km} km)`, amount_money: { amount: delivery.fee, currency: menu.currency }, calculation_phase: "SUBTOTAL_PHASE", taxable: true }];
  }
  return order;
}

module.exports = { OrderError, priceCart, buildSquareOrder, normalizePhone, shopDateAt, openChristmasDates };
