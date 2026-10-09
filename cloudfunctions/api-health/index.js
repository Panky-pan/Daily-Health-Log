// 云函数：api-health（HTTP 型云函数）
// 作用：项目唯一的 HTTP 接口入口。本文件只做三件事 ——
//      拉起 HTTP 服务、按路径分发路由、兜住任何异常（接请求 → 调 handler → 返响应）。
//      所有业务都在 handlers/，数据库查询都在 repositories/，字段校验在 validators/，
//      常量与工具在 lib/。
//
//   已实现：
//     A1  GET /api/health            健康检查（响应形状是契约的唯一例外，不带 data 包裹）
//     A2  GET /api/settings          读目标设置（表 settings，单人只有一条）
//     A3  PUT /api/settings          存 / 改目标设置（upsert；startDate 首次写入后永不覆盖）
//     A4  GET /api/checkins          列表读取打卡记录（表 checkins，一天一条）
//     A5  GET /api/checkins/{date}   读单日记录（那天没打卡回 200 + record:null）
//     A6  PUT /api/checkins/{date}   保存 / 覆盖单日记录（PUT 全量覆盖，唯一的 upsert 写入口）
//     A8  PATCH /api/checkins/{date} 局部修改单日记录（只改请求体里出现的字段，没出现的字段不动）
//     A9  DELETE /api/checkins/{date} 删除单日记录（**软删除**：数据留着，只打 is_deleted 标记）
//     A10 POST /api/checkins/{date}/restore 恢复被删的那天（把 A9 的标记清掉）
//
//   未实现（契约登记待做）：
//     A7  POST /api/checkins/import  批量导入（本地数据迁移专用，可延后）
//
// 目录分层（本文件是唯一的路由表，别处不许再写路由）：
//   handlers/     接请求、调 repository、返响应
//   repositories/ 所有数据库查询（表名 = 文件名）
//   validators/   请求体字段校验
//   lib/          常量、数据库客户端、响应输出、字段转换、日期工具、请求体读取
//
// 字段与响应形状的唯一依据：api-contract.md（2.2 响应形状 / 2.6 空值 / 4.3 A2 / 4.5 A4 / 4.7 A6）。
// 代码与文档冲突时以文档为准。
//
// 关键约定（HTTP 型云函数）：就是一个标准 Web 服务，必须监听 9000 端口，
//   并随代码包附带 scf_bootstrap 启动脚本（由平台执行它来拉起本服务）。

const http = require("http");
const { URL } = require("url");

const { CORS_HEADERS, sendFail, sendMethodNotAllowed } = require("./lib/response");
const { ERR } = require("./lib/errors");
const { ALLOWED_ORIGINS } = require("./lib/config");
const { handleHealth } = require("./handlers/health");
const { handleGetSettings, handlePutSettings } = require("./handlers/settings");
const { handleListCheckins, handleGetCheckin, handlePutCheckin, handlePatchCheckin, handleDeleteCheckin, handleRestoreCheckin } = require("./handlers/checkins");

// ---------------------------------------------------------------------------
// CORS 白名单（2026-10-06 方案 A）：读写接口一律校验来源
// ---------------------------------------------------------------------------
// 背景：CloudBase 网关会自动回显请求的 Origin 并带 credentials，等于「对所有
// 域名开放跨域」，响应头层面拦不住（见 lib/response.js 踩坑注释与契约 2.7）。
// 所以在服务端拦：带 Origin 且不在白名单 → 403，一个字节的数据都不给。
// 不带 Origin 的请求（curl / Postman / 服务端脚本）放行：它们不受浏览器同源
// 策略约束，校验 Origin 没有意义，本期单人自用不做更重的鉴权（见契约 2.5）。
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 非浏览器请求（curl 等），放行
  if (ALLOWED_ORIGINS.includes(origin)) return true; // 线上域名 + file:// 的 "null"
  // 本地开发：python -m http.server / Live Server 端口不固定，放行所有本机地址
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// ---------------------------------------------------------------------------
// 进程级兜底
// ---------------------------------------------------------------------------
// 实测发现（2026-10-02）：凭证缺失/失效时，数据库 SDK 会在「后台」另起一个 Promise
// 并让它失败，这个失败不在我们的 await 链上，Node 遇到这种「未处理的 Promise 拒绝」
// 默认会直接杀掉进程 —— 结果平台回一个 HTML 错误页，用户读到一堆乱码，
// 违背契约 2.3「任何情况下都返回 JSON」。
// 所以这里只记日志、不让进程退出；真正的错误仍由下面的请求处理返回 500 JSON。
process.on("unhandledRejection", (reason) => {
  console.error("[api-health] 后台出现未处理的 Promise 失败（已吞掉，进程继续）:", reason);
});

// ---------------------------------------------------------------------------
// 服务本体
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // ---------------------------------------------------------------------------
  // 请求日志（2026-10-08 加）：时间 / 路径 / 结果
  // ---------------------------------------------------------------------------
  // 挂在服务入口这一处，403 / OPTIONS / 404 / 405 / 200 / 500 全部自动覆盖，
  // 不用在每个 handler 里重复写。
  // 为什么用 res 的 "finish" 事件而不是在这里直接打印：响应结束时状态码才
  // 确定，这样才能记下"结果"（成功还是 404 / 405 / 500）。
  // 只记方法、路径、状态码、耗时 —— 不记请求体，避免把三餐 / 体重写进日志。
  const startedAt = Date.now();
  const logPath = (req.url || "/").split("?")[0]; // 去掉查询串，保证一行清爽
  res.on("finish", () => {
    console.log(
      `[api-health] ${new Date().toISOString()} ${req.method} ${logPath} → ${res.statusCode} (${Date.now() - startedAt}ms)`
    );
  });

  // CORS 白名单：名单外的来源（含它发的预检请求）一律 403，先于所有路由与 OPTIONS
  if (!originAllowed(req)) {
    return sendFail(res, 403, ERR.FORBIDDEN, "这个来源不在允许名单里");
  }

  // 浏览器跨域预检请求（OPTIONS）直接放行
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;

  // 兜底 try/catch：任何意外都回 JSON，绝不回 HTML 错误页（契约 2.3）
  try {
    if (path === "/api/health") {
      if (req.method !== "GET") return sendMethodNotAllowed(res, req.method);
      return handleHealth(res);
    }

    if (path === "/api/settings") {
      // A2 读 / A3 写（upsert，单人只有一条设置）
      if (req.method === "GET") return await handleGetSettings(res);
      if (req.method === "PUT") return await handlePutSettings(res, req);
      return sendMethodNotAllowed(res, req.method);
    }

    if (path === "/api/checkins") {
      // 写单日记录不用这个地址（那是 A6 的 /api/checkins/{date}）
      if (req.method !== "GET") return sendMethodNotAllowed(res, req.method);
      return await handleListCheckins(res, url.searchParams);
    }

    // A5 · GET /api/checkins/{date}（读单日）/ A6 · PUT（保存 / 覆盖单日）/ A8 · PATCH（局部修改单日）
    // A9 · DELETE（软删除单日）/ A10 · POST /{date}/restore（恢复被删的那天）
    if (path.startsWith("/api/checkins/")) {
      const rest = path.slice("/api/checkins/".length);
      // A7 批量导入（POST /api/checkins/import）登记待实现，先当路径不存在（契约 4.8）
      if (rest === "import") return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");
      // 只写到 /api/checkins/、后面没跟日期：这不是任何已登记的路径（契约 2.3 的 404）
      if (rest === "") return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");

      // A10 · POST /api/checkins/{date}/restore —— 恢复
      // 必须在下面「按方法分发」之前拦下来：它的路径多一段 /restore，
      // 若不先剥掉，rest 会变成 "2026-08-01/restore" 被当成日期，日期格式校验直接判错。
      if (rest.endsWith("/restore")) {
        const targetDate = rest.slice(0, -"/restore".length);
        if (req.method !== "POST") return sendMethodNotAllowed(res, req.method);
        return await handleRestoreCheckin(res, targetDate);
      }
      // 其余带斜杠的变体（如 /{date}/xxx）都是没登记过的路径
      if (rest.includes("/")) return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");

      if (req.method === "GET") return await handleGetCheckin(res, rest);
      if (req.method === "PATCH") return await handlePatchCheckin(res, rest, req);
      if (req.method === "DELETE") return await handleDeleteCheckin(res, rest);
      // 路径对、方法不对（比如 POST 这个地址）→ 405（契约 2.3）
      if (req.method !== "PUT") return sendMethodNotAllowed(res, req.method);
      return await handlePutCheckin(res, rest, req);
    }

    // 路径不存在（含还没实现的 A7 POST /api/checkins/import）
    return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");
  } catch (e) {
    console.error("[api-health] 未捕获异常:", e);
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "服务出了点问题，稍后再试");
  }
});

// HTTP 型云函数平台约定：必须监听 9000 端口
server.listen(9000);
