// POST /api/checkout — see lib/checkout.js
const route = require("../lib/vercel");
const { checkout } = require("../lib/checkout");
module.exports = route((body) => checkout(body));
