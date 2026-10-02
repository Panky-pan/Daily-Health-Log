// 云函数：api-health（HTTP 型云函数）
// 作用：项目唯一的 HTTP 接口入口（单入口，按路径分发路由）。
//   已实现：
//     A1  GET /api/health            健康检查（响应形状是契约的唯一例外，不带 data 包裹）
//     A2  GET /api/settings          读目标设置（表 settings，单人只有一条）
//     A4  GET /api/checkins          列表读取打卡记录（表 checkins，一天一条）
//
// 字段与响应形状的唯一依据：api-contract.md（2.2 响应形状 / 2.6 空值 / 4.3 A2 / 4.5 A4）。
// 代码与文档冲突时以文档为准。
//
// 关键约定（HTTP 型云函数）：就是一个标准 Web 服务，必须监听 9000 端口，
//   并随代码包附带 scf_bootstrap 启动脚本（由平台执行它来拉起本服务）。

const http = require("http");
const { URL } = require("url");

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
// 常量
// ---------------------------------------------------------------------------

// 环境 ID 不是密钥（它本来就写在公网地址里），作为兜底默认值；
// 云函数环境里有 TCB_ENV 时优先用环境里的。
const ENV_ID = process.env.TCB_ENV || "daily-health-log-d3eej7197499a30";

// 本期是单人自用，所有行都归属 user_id = 0（见 api-contract.md 3.4）。
// 抽成常量是为了二期接入登录时只改这一处。
const USER_ID = 0;

// A4 的区间保护：一次最多查 400 天（契约 4.5 / TECH_DESIGN B6）
const MAX_RANGE_DAYS = 400;

// 错误码字典：前端按 code 分支，message 是给人看的中文口语短句（契约 2.2 / 2.3）
const ERR = {
  INVALID_PARAM: "INVALID_PARAM",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  DB_ERROR: "DB_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

// CORS 响应头：先放开所有来源，浏览器前端调接口时才不会被跨域拦住；
// 原生 APP（Flutter）没有跨域概念，不受此影响。
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---------------------------------------------------------------------------
// 数据库客户端（懒加载）
// ---------------------------------------------------------------------------

// 为什么懒加载：/api/health 不碰数据库，就算凭证还没配好也该能探活。
let _db = null;

function getDb() {
  if (_db) return _db;
  // 服务端 SDK；数据库访问走 CloudBase PG 网关（免 VPC、免数据库密码）。
  // 凭证从云函数环境变量 CLOUDBASE_APIKEY 自动读取，绝不写进代码。
  const tcb = require("@cloudbase/node-sdk");
  const app = tcb.init({ env: ENV_ID });
  // 必须显式指定 database: "public"！
  // SDK 内部是 `const { database = envId } = options`（见 node-sdk dist/cloudbase.js）——
  // 不传时它会把「环境 ID」当成 schema 名塞进 Accept-Profile / Content-Profile 头，
  // 网关就回 406 DATABASE_PGRST106「Invalid schema: <环境ID>」。
  // 实测（2026-10-02）：加上这一项，读表立刻成功。
  _db = app.rdb({ instance: "default", database: "public" });
  return _db;
}

// ---------------------------------------------------------------------------
// 统一的响应输出
// ---------------------------------------------------------------------------

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
// field 只在字段级校验错误时才带（本期 A2/A4 是读接口，暂时用不到，先留着给 A3/A6）。
function sendFail(res, statusCode, code, message, field) {
  const error = { code, message };
  if (field) error.field = field;
  sendJson(res, statusCode, { ok: false, error });
}

// 数据库读失败 → 500 DB_ERROR（契约 2.3）。真实错误只进云端日志，不回给前端。
function sendDbError(res, where, error) {
  console.error(`[api-health] ${where} 读数据库失败:`, error);
  return sendFail(res, 500, ERR.DB_ERROR, "记录暂时取不出来，稍后再试");
}

function sendMethodNotAllowed(res, method) {
  return sendFail(res, 405, ERR.METHOD_NOT_ALLOWED, `这个地址不支持 ${method} 请求`);
}

// ---------------------------------------------------------------------------
// 服务器时间（A1 用）
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 字段转换：数据库 snake_case + NULL  →  API camelCase + ""
// ---------------------------------------------------------------------------

// 契约 2.6：用户没填的字段回 "" 而不是 null（否则前端会渲染出 "null kg"）。
// 数据库那边存的是 NULL（契约 3.4 的空值分工），转换只在这一层做一次。
function text(v) {
  return v === null || v === undefined ? "" : String(v);
}

// 数值字段：有值回 number，没值回 ""
function num(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

// 日期：全链路只认 YYYY-MM-DD 字符串，不做任何时区换算（硬约束 3）
function dateOnly(v) {
  if (typeof v === "string") return v.slice(0, 10);
  // PG 的 DATE 类型取出来是 UTC 零点，用 UTC 取年月日不会错位到前一天
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v === null || v === undefined ? "" : String(v).slice(0, 10);
}

// 单日记录：数据库行 → API 对象（契约 3.2 的字段顺序）
function checkinToApi(row) {
  return {
    date: dateOnly(row.date),
    exerciseType: text(row.exercise_type),
    exerciseMinutes: num(row.exercise_minutes),
    exerciseCalories: num(row.exercise_calories),
    mealBreakfastText: text(row.meal_breakfast_text),
    mealBreakfastTag: text(row.meal_breakfast_tag),
    mealLunchText: text(row.meal_lunch_text),
    mealLunchTag: text(row.meal_lunch_tag),
    mealDinnerText: text(row.meal_dinner_text),
    mealDinnerTag: text(row.meal_dinner_tag),
    weightKg: num(row.weight_kg),
    waterMl: num(row.water_ml),
  };
}

// 目标设置：数据库行 → API 对象（契约 3.3）
function settingsToApi(row) {
  return {
    goalExerciseMinutes: num(row.goal_exercise_minutes),
    goalWaterMl: num(row.goal_water_ml),
    startDate: dateOnly(row.start_date),
  };
}

// ---------------------------------------------------------------------------
// 参数校验（A4）
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 既要格式对，也要是真实存在的日期（挡住 2026-02-30 这种）
function isDateStr(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// 两个日期字符串之间差多少天（都按 UTC 零点算，不会有夏令时误差）
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------
// 路由处理
// ---------------------------------------------------------------------------

// A1 · GET /api/health —— 响应形状由任务清单指定，是契约 2.2 的唯一例外
function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    service: "daily-health-log-demo",
    time: serverTime(),
  });
}

// A2 · GET /api/settings
async function handleGetSettings(res) {
  const { data, error } = await getDb()
    .from("settings")
    .select("*")
    .eq("user_id", USER_ID)
    .limit(1);

  if (error) return sendDbError(res, "GET /api/settings", error);

  const row = Array.isArray(data) ? data[0] : data;
  // 还没设置过 → 200 + settings: null（不是 404，契约 4.3）
  return sendOk(res, { settings: row ? settingsToApi(row) : null });
}

// A4 · GET /api/checkins
async function handleListCheckins(res, params) {
  const from = params.get("from");
  const to = params.get("to");

  // 校验一律放在查数据库之前：参数不对就不必打扰数据库
  if (from !== null && !isDateStr(from)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "起始日期格式不对，应该写成 2026-09-21 这样");
  }
  if (to !== null && !isDateStr(to)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "结束日期格式不对，应该写成 2026-09-21 这样");
  }
  if (from && to && from > to) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "起始日期不能晚于结束日期");
  }
  if (from && to && daysBetween(from, to) > MAX_RANGE_DAYS) {
    return sendFail(res, 400, ERR.INVALID_PARAM, `一次最多查 ${MAX_RANGE_DAYS} 天的记录`);
  }

  // 参数化：日期是作为「结构化参数」传给 SDK 的，不会被拼进查询语句，
  // 所以 from / to 里塞什么都改不了查询本身（这就是防注入）。
  let query = getDb().from("checkins").select("*").eq("user_id", USER_ID);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  // 升序：趋势图直接按顺序连线（契约 4.5）
  const { data, error } = await query.order("date", { ascending: true });
  if (error) return sendDbError(res, "GET /api/checkins", error);

  const items = (Array.isArray(data) ? data : []).map(checkinToApi);
  // 没有记录时回空数组 + total: 0，这是正常状态不是错误（契约 4.5）
  return sendOk(res, { items, total: items.length });
}

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
      // A6（PUT）今天还没做，所以除了 GET 都回 405
      if (req.method !== "GET") return sendMethodNotAllowed(res, req.method);
      return await handleListCheckins(res, url.searchParams);
    }

    // 路径不存在（含还没实现的 A5 /api/checkins/{date}、A7 import）
    return sendFail(res, 404, ERR.NOT_FOUND, "没有这个接口");
  } catch (e) {
    console.error("[api-health] 未捕获异常:", e);
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "服务出了点问题，稍后再试");
  }
});

// HTTP 型云函数平台约定：必须监听 9000 端口
server.listen(9000);
