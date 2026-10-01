// 云函数：api-health（HTTP 型云函数）
// 作用：健康检查接口 GET /api/health —— 项目的第一个云函数，不连数据库、无业务逻辑。
// 关键约定：HTTP 型云函数就是一个标准 Web 服务，必须监听 9000 端口，
//          并随代码包附带 scf_bootstrap 启动脚本（由平台执行它来拉起本服务）。

const http = require("http");
const { URL } = require("url");

// CORS 响应头：先放开所有来源，第 3 周浏览器前端调接口时才不会被跨域拦住；
// 原生 APP（Flutter）没有跨域概念，不受此影响。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 统一的 JSON 输出：显式设置状态码与 Content-Type
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

// 服务器时间：按北京时间（Asia/Shanghai）输出，形如 2026-10-01 00:55:30，
// 浏览器里看到就能直接对上钟，不用手动换算 UTC。
// 小技巧：Intl 用瑞典语 locale（sv-SE）恰好产出「年-月-日 时:分:秒」这种好读格式。
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

const server = http.createServer((req, res) => {
  // 浏览器跨域预检请求（OPTIONS）直接放行
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");

  // 唯一的业务路由：GET /api/health
  if (url.pathname === "/api/health" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "daily-health-log-demo",
      time: serverTime(),
    });
  }

  // 路径存在但方法不对 → 405；其余未知路径 → 404
  if (url.pathname === "/api/health") {
    return sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
  }
  return sendJson(res, 404, { ok: false, error: "Not Found" });
});

// HTTP 型云函数平台约定：必须监听 9000 端口
server.listen(9000);
