// lib/response.js —— 统一的响应输出
//
// 全部 HTTP 出口都从这里走，保证「任何情况下都返回 JSON」（契约 2.3）：
// 成功 { ok: true, data }，失败 { ok: false, error: { code, message, field? } }。

const { ERR } = require("./errors");

// CORS 响应头。
//
// 注意（2026-10-02 实测踩坑）：**不要自己写 "Access-Control-Allow-Origin"**。
// CloudBase 的 HTTP 网关（响应头里 server: tcbgw）会自己回跨域头，并且回的是
//   access-control-allow-credentials: true
//   access-control-allow-origin: <请求的 Origin>
// 我们若再写一个 "*"，网关会把两者拼成 "http://xxx,*"（带 credentials 时 Allow-Origin
// 不允许是 "*"，更不允许逗号多值）→ 浏览器判定跨域失败，前端报 "Failed to fetch"。
// 所以这里只保留方法/请求头两项，Allow-Origin 交给网关。
// 注意（2026-10-07 更新）：PATCH / DELETE 接口上线后，方法列表加 PATCH, DELETE。
//   不在白名单里就发不出真请求（预检会回 Allow-Methods，浏览器据此判断能不能发）。
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(body));
}

// 成功：{ ok: true, data: ... }（契约 2.2）
function sendOk(res, data) {
  sendJson(res, 200, { ok: true, data });
}

// 失败：{ ok: false, error: { code, message, field? } }（契约 2.2）
// field 只在字段级校验错误时才带。
function sendFail(res, statusCode, code, message, field) {
  const error = { code, message };
  if (field) error.field = field;
  sendJson(res, statusCode, { ok: false, error });
}

// 数据库读写失败 → 500 DB_ERROR（契约 2.3）。真实错误只进云端日志，不回给前端。
// message 可覆盖：读失败说"取不出来"，写失败说"没存上"，都比一句笼统的"出错了"好懂。
// where 是排查用的路标（例如 "PUT /api/checkins 写库"），重构后原样保留。
function sendDbError(res, where, error, message = "记录暂时取不出来，稍后再试") {
  console.error(`[api-health] ${where} 访问数据库失败:`, error);
  return sendFail(res, 500, ERR.DB_ERROR, message);
}

function sendMethodNotAllowed(res, method) {
  return sendFail(res, 405, ERR.METHOD_NOT_ALLOWED, `这个地址不支持 ${method} 请求`);
}

module.exports = {
  CORS_HEADERS,
  sendJson,
  sendOk,
  sendFail,
  sendDbError,
  sendMethodNotAllowed,
};
