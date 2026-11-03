const test = require("node:test");
const assert = require("node:assert");
const { signup } = require("../lib/signup");

const okFetch = (log) => async (url, opts) => { log.push([url, JSON.parse(opts.body)]); return { ok: true }; };
const env = (vars) => { const old = {}; for (const k in vars) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } return () => env(old); };

test("waitlist sign-up becomes a Square customer in the group, and emails the shop", async () => {
  const restore = env({ SQUARE_ACCESS_TOKEN: "t", SQUARE_WAITLIST_GROUP_ID: "G1", RESEND_API_KEY: "r", NOTIFY_EMAIL: "hello@studioseven.ca" });
  const calls = [], mails = [];
  const sq = async (path, body, method) => { calls.push([path, body, method]); if (path === "/v2/customers/search") return {}; if (path === "/v2/customers") return { customer: { id: "C1" } }; return {}; };
  const res = await signup({ type: "waitlist", name: "Jo", email: "Jo@Example.com ", phone: "705-555-0142", interests: "Coffee, Flowers", town: "Omemee" }, { square: sq, fetch: okFetch(mails) });
  restore();
  assert.equal(res.status, 200);
  assert.equal(calls[1][1].email_address, "jo@example.com");
  assert.equal(calls[1][1].phone_number, "+17055550142");
  assert.deepEqual(calls[2], ["/v2/customers/C1/groups/G1", undefined, "PUT"]);
  assert.equal(mails[0][1].to[0], "hello@studioseven.ca");
  assert.match(mails[0][1].subject, /Jo/);
});

test("an existing customer is reused, not duplicated", async () => {
  const restore = env({ SQUARE_ACCESS_TOKEN: "t", RESEND_API_KEY: undefined, SQUARE_WAITLIST_GROUP_ID: undefined });
  const paths = [];
  const sq = async (path) => { paths.push(path); return path === "/v2/customers/search" ? { customers: [{ id: "C9" }] } : {}; };
  const res = await signup({ type: "waitlist", name: "Jo", email: "jo@example.com" }, { square: sq, fetch: okFetch([]) });
  restore();
  assert.equal(res.status, 200);
  assert.deepEqual(paths, ["/v2/customers/search"]);
});

test("coffee cart request still counts if Square is down but the email sends", async () => {
  const restore = env({ SQUARE_ACCESS_TOKEN: "t", RESEND_API_KEY: "r", NOTIFY_EMAIL: "a@b.co" });
  const mails = [];
  const res = await signup({ type: "cart-booking", name: "Pat", email: "pat@example.com", occasion: "Wedding", date: "2027-08-14", guests: "100–200", location: "Lindsay", flowers: "Yes" }, { square: async () => { throw new Error("down"); }, fetch: okFetch(mails) });
  restore();
  assert.equal(res.status, 200);
  assert.match(mails[0][1].subject, /Wedding on 2027-08-14/);
  assert.match(mails[0][1].text, /Location: Lindsay/);
});

test("fails loudly only when nothing could be saved or sent", async () => {
  const restore = env({ SQUARE_ACCESS_TOKEN: "t", RESEND_API_KEY: undefined });
  const res = await signup({ type: "waitlist", name: "Jo", email: "jo@example.com" }, { square: async () => { throw new Error("down"); } });
  restore();
  assert.equal(res.status, 502);
});

test("rejects bad input and quietly drops bots", async () => {
  assert.equal((await signup({ type: "waitlist", name: "", email: "jo@example.com" })).status, 400);
  assert.equal((await signup({ type: "waitlist", name: "Jo", email: "nope" })).status, 400);
  assert.equal((await signup({ type: "other", name: "Jo", email: "jo@example.com" })).status, 400);
  let touched = false;
  const res = await signup({ type: "waitlist", name: "Bot", email: "b@b.co", company: "Spam Inc" }, { square: async () => { touched = true; } });
  assert.equal(res.status, 200);
  assert.equal(touched, false);
});
