// handlers/health.js —— A1 · GET /api/health
//
// 响应形状由任务清单指定，是契约 2.2 的唯一例外（不带 data 包裹）。
// 这个接口不碰数据库：数据库连不上时它也必须能回 200，用来区分「服务挂了」和「库挂了」。

const { sendJson } = require("../lib/response");

// 按北京时间（Asia/Shanghai）输出，形如 2026-10-01 00:55:30，
// 浏览器里看到就能直接对上钟，不用手动换算 UTC。
function serverTime() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    service: "daily-health-log-demo",
    time: serverTime(),
  });
}

module.exports = { handleHealth };
