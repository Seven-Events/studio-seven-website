// Photo focus spots, saved from /focus.html.
// Each spot is stored on the item in Square as a custom attribute ("Photo focus", e.g. "62% 45%"),
// so it lives with the item and the menu picks it up like any other item detail.
// Saving needs the staff password (STAFF_PASSWORD in Vercel).
const crypto = require("crypto");
const { square } = require("./square");

const KEY = "photo_focus";
const FOCUS = /^(\d{1,3})% (\d{1,3})%$/;

function validFocus(v) {
  const m = FOCUS.exec(String(v == null ? "" : v).trim());
  return m && +m[1] <= 100 && +m[2] <= 100 ? `${+m[1]}% ${+m[2]}%` : null;
}

/** The focus stored on a Square item, or null. Matches the key with or without another app's prefix. */
function focusFromSquare(obj) {
  const vals = (obj && obj.custom_attribute_values) || {};
  for (const k of Object.keys(vals)) {
    if (k === KEY || k.endsWith(":" + KEY)) return validFocus(vals[k] && vals[k].string_value);
  }
  return null;
}

function samePassword(given, expected) {
  const a = crypto.createHash("sha256").update(String(given || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

async function ensureDefinition(call) {
  let cursor;
  do {
    const page = await call("/v2/catalog/search", { object_types: ["CUSTOM_ATTRIBUTE_DEFINITION"], cursor });
    if ((page.objects || []).some((o) => o.custom_attribute_definition_data && o.custom_attribute_definition_data.key === KEY)) return;
    cursor = page.cursor;
  } while (cursor);
  await call("/v2/catalog/object", {
    idempotency_key: "s7-photo-focus-definition",
    object: {
      type: "CUSTOM_ATTRIBUTE_DEFINITION", id: "#photo_focus",
      custom_attribute_definition_data: {
        type: "STRING", name: "Photo focus", key: KEY, allowed_object_types: ["ITEM"],
        description: "Where the website keeps the photo in view when it crops it, as across% down%. Set from the website's /focus.html page.",
        seller_visibility: "SELLER_VISIBILITY_READ_WRITE_VALUES", app_visibility: "APP_VISIBILITY_READ_WRITE_VALUES",
      },
    },
  });
}

/** POST /api/focus { password, itemId, focus } */
async function saveFocus(body, { square: call = square, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const b = body || {};
  if (!process.env.STAFF_PASSWORD) return { status: 503, body: { error: "Saving isn't switched on yet. Add STAFF_PASSWORD in Vercel." } };
  if (!samePassword(b.password, process.env.STAFF_PASSWORD)) { await wait(800); return { status: 401, body: { error: "That password isn't right." } }; }
  const focus = validFocus(b.focus);
  const itemId = String(b.itemId || "");
  if (!focus || !/^[A-Za-z0-9_-]{1,64}$/.test(itemId)) return { status: 400, body: { error: "Pick a spot on the photo first." } };

  try {
    await ensureDefinition(call);
    for (let attempt = 0; attempt < 2; attempt++) {
      const got = await call(`/v2/catalog/object/${encodeURIComponent(itemId)}`, undefined, "GET");
      const obj = got.object;
      if (!obj || obj.type !== "ITEM" || obj.is_deleted) return { status: 404, body: { error: "That item isn't in Square any more." } };
      obj.custom_attribute_values = { ...(obj.custom_attribute_values || {}), [KEY]: { string_value: focus } };
      try {
        await call("/v2/catalog/object", { idempotency_key: crypto.randomUUID(), object: obj });
        return { status: 200, body: { ok: true, focus } };
      } catch (err) {
        const code = err && err.errors && err.errors[0] && err.errors[0].code;
        if (code !== "VERSION_MISMATCH" || attempt) throw err; // someone edited the item at the same moment: re-read and try once more
      }
    }
  } catch (err) {
    console.error("focus save failed", err && err.errors ? JSON.stringify(err.errors) : err);
    return { status: 502, body: { error: "Square didn't save it. Please try again." } };
  }
}

module.exports = { saveFocus, focusFromSquare, validFocus, KEY };
