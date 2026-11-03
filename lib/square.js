// Tiny Square REST client (no dependencies). Docs: https://developer.squareup.com/reference/square
const SQUARE_VERSION = "2025-01-23";

function baseUrl() {
  return process.env.SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

class SquareError extends Error {
  constructor(errors, status) {
    super((errors && errors[0] && errors[0].detail) || "Square request failed");
    this.name = "SquareError"; this.errors = errors || []; this.status = status;
  }
}

async function square(path, body, fetchImpl = fetch) {
  const res = await fetchImpl(baseUrl() + path, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) throw new SquareError(data.errors, res.status);
  return data;
}

// Card problems the customer can fix, in plain words.
const CARD_MESSAGES = {
  CARD_DECLINED: "Your card was declined. Please try another card.",
  GENERIC_DECLINE: "Your card was declined. Please try another card.",
  INSUFFICIENT_FUNDS: "Your card was declined for insufficient funds. Please try another card.",
  CVV_FAILURE: "The security code (CVV) didn't match. Please check it and try again.",
  ADDRESS_VERIFICATION_FAILURE: "The postal code didn't match your card. Please check it and try again.",
  INVALID_EXPIRATION: "The expiry date looks wrong. Please check it and try again.",
  EXPIRATION_FAILURE: "That card has expired. Please try another card.",
  INVALID_CARD: "That card number isn't valid. Please check it and try again.",
  CARD_DECLINED_VERIFICATION_REQUIRED: "Your bank needs to verify this payment. Please try again and follow your bank's prompt.",
};
function friendlyPaymentError(err) {
  const code = err && err.errors && err.errors[0] && err.errors[0].code;
  return CARD_MESSAGES[code] || "We couldn't take the payment. Nothing was charged. Please try again, or call the shop.";
}

module.exports = { square, SquareError, friendlyPaymentError, baseUrl };
