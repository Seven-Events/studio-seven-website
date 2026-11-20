// POST /api/address { q } — delivery address suggestions as customers type. See lib/address.js
const route = require("../lib/vercel");
const { suggestAddresses } = require("../lib/address");
module.exports = route((body) => suggestAddresses(body));
