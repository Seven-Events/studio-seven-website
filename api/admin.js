// POST /api/admin — staff page for closed days and no-delivery days. See lib/schedule.js
const route = require("../lib/vercel");
const { adminSchedule } = require("../lib/schedule");
module.exports = route((body) => adminSchedule(body));
