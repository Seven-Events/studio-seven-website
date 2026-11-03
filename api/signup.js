// POST /api/signup — opening list and coffee cart requests. See lib/signup.js
const route = require("../lib/vercel");
const { signup } = require("../lib/signup");
module.exports = route((body) => signup(body));
