// POST /api/focus — save a photo focus spot to the item in Square. See lib/focus.js
const route = require("../lib/vercel");
const { saveFocus } = require("../lib/focus");
module.exports = route((body) => saveFocus(body));
