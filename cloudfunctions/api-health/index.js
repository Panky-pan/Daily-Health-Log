// 云函数：api-health（HTTP 型云函数）
// 作用：项目唯一的 HTTP 接口入口。本文件只做三件事 ——
//      拉起 HTTP 服务、按路径分发路由、兜住任何异常（接请求 → 调 handler → 返响应）。
//      所有业务都在 handlers/，数据库查询都在 repositories/，字段校验在 validators/，
//      常量与工具在 lib/。
//
//   已实现：
//     A1  GET /api/health            健康检查（响应形状是契约的唯一例外，不带 data 包裹）
//     A2  GET /api/settings          读目标设置（表 settings，单人只有一条）
//     A4  GET /api/checkins          列表读取打卡记录（表 checkins，一天一条）
//     A6  PUT /api/checkins/{date}   保存 / 覆盖单日记录（唯一的写入口）
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
const { handleHealth } = require("./handlers/health");
const { handleGetSettings } = require("./handlers/settings");
const { handleListCheckins, handlePutCheckin } = require("./handlers/checkins");

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
      // A3（PUT）今天还没做，所以除了 GET 都回 405
      if (req.method !== "GET") return sendMethodNotAllowed(res, req.method);
      return await handleGetSettings(res);
    }

    if (path === "/api/checkins") {
      // 写单日记录不用这个地址（那是 A6 的 /api/checkins/{date}）
      if (req.method !== "GET") return sendMethodNotAllowed(res, req.method);
      return await handleListCheckins(res, url.searchParams);
    }

    // A6 · /api/checkins/{date}：保存 / 覆盖单日记录
    if (path.startsWith("/api/checkins/")) {
      const rest = path.slice("/api/checkins/".length);
      // A7 批量导入（POST /api/checkins/import）登记待实现，先当路径不存在（契约 4.8）
      if (rest === "import") return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");
      // 路径对、方法不对（比如 GET 或 POST 这个地址）→ 405（契约 2.3）
      if (req.method !== "PUT") return sendMethodNotAllowed(res, req.method);
      return await handlePutCheckin(res, rest, req);
    }

    // 路径不存在（含还没实现的 A5 GET /api/checkins/{date}、A3 /api/settings 的 PUT）
    return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");
  } catch (e) {
    console.error("[api-health] 未捕获异常:", e);
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "服务出了点问题，稍后再试");
  }
});

// HTTP 型云函数平台约定：必须监听 9000 端口
server.listen(9000);
