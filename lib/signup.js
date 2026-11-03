// Opening-list sign-ups and coffee cart requests.
// Each one is saved as a customer in Square (so the list lives with your sales data and a future admin can read it),
// and the shop gets an email through Resend. Either one is enough for the request to count as received.
const { square } = require("./square");

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TYPES = {
  "waitlist": {
    fields: { name: 80, email: 120, phone: 30, interests: 200, town: 80 },
    subject: (f) => `New opening-list sign-up: ${f.name}`,
    note: (f) => `Opening list (website). Interested in: ${f.interests || "-"}. From: ${f.town || "-"}.`,
    groupEnv: "SQUARE_WAITLIST_GROUP_ID",
  },
  "cart-booking": {
    fields: { name: 80, email: 120, occasion: 60, date: 10, guests: 30, location: 120, flowers: 3 },
    subject: (f) => `Coffee cart request: ${f.occasion} on ${f.date || "date TBC"}`,
    note: (f) => `Coffee cart request (website): ${f.occasion}, ${f.date || "date TBC"}, ${f.guests} guests, at ${f.location || "-"}. Flowers: ${f.flowers || "No"}.`,
    groupEnv: "SQUARE_CART_GROUP_ID",
  },
};

function toE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  return ten.length === 10 ? "+1" + ten : undefined;
}

async function saveToSquare(f, type, call) {
  const found = await call("/v2/customers/search", { query: { filter: { email_address: { exact: f.email } } }, limit: 1 });
  let id = found.customers && found.customers[0] && found.customers[0].id;
  if (!id) {
    const created = await call("/v2/customers", {
      idempotency_key: `${type.groupEnv}-${f.email}`.slice(0, 45),
      given_name: f.name,
      email_address: f.email,
      phone_number: toE164(f.phone),
      note: type.note(f),
      reference_id: "website",
    });
    id = created.customer.id;
  }
  const group = process.env[type.groupEnv];
  if (group) await call(`/v2/customers/${id}/groups/${group}`, undefined, "PUT");
  return id;
}

async function emailShop(f, type, fetchImpl) {
  const { RESEND_API_KEY, NOTIFY_EMAIL, FROM_EMAIL } = process.env;
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) return false;
  const lines = Object.keys(type.fields).map((k) => `${k[0].toUpperCase() + k.slice(1)}: ${f[k] || "-"}`);
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL || "Studio Seven website <onboarding@resend.dev>",
      to: NOTIFY_EMAIL.split(",").map((s) => s.trim()),
      reply_to: f.email,
      subject: type.subject(f),
      text: lines.join("\n") + "\n\nSent from the Studio Seven website.",
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  return true;
}

async function signup(input, deps = {}) {
  const reply = (status, body) => ({ status, body });
  if (!input || typeof input !== "object") return reply(400, { error: "Bad request." });
  if (input.company) return reply(200, { ok: true }); // honeypot field: bots fill it, people never see it
  const type = TYPES[input.type];
  if (!type) return reply(400, { error: "Bad request." });

  const f = {};
  for (const [k, max] of Object.entries(type.fields)) f[k] = clean(input[k], max);
  f.email = f.email.toLowerCase();
  if (!f.name) return reply(400, { error: "Please add your name." });
  if (!EMAIL.test(f.email)) return reply(400, { error: "That email doesn't look right. Try name@example.com." });

  const call = deps.square || square;
  const fetchImpl = deps.fetch || fetch;
  const hasSquare = !!process.env.SQUARE_ACCESS_TOKEN;
  const results = await Promise.allSettled([
    hasSquare ? saveToSquare(f, type, call) : Promise.resolve(null),
    emailShop(f, type, fetchImpl),
  ]);
  const savedOk = results[0].status === "fulfilled" && results[0].value;
  const emailedOk = results[1].status === "fulfilled" && results[1].value;
  results.forEach((r) => r.status === "rejected" && console.error("signup step failed", r.reason && (r.reason.errors ? JSON.stringify(r.reason.errors) : r.reason.message)));
  if (!savedOk && !emailedOk) return reply(502, { error: "That didn't go through. Please try again in a minute." });
  return reply(200, { ok: true });
}

module.exports = { signup, TYPES };
