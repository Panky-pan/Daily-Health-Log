// 云函数：api-health（HTTP 型云函数）
// 作用：项目唯一的 HTTP 接口入口（单入口，按路径分发路由）。
//   已实现：
//     A1  GET /api/health            健康检查（响应形状是契约的唯一例外，不带 data 包裹）
//     A2  GET /api/settings          读目标设置（表 settings，单人只有一条）
//     A4  GET /api/checkins          列表读取打卡记录（表 checkins，一天一条）
//     A6  PUT /api/checkins/{date}   保存 / 覆盖单日记录（唯一的写入口）
//
// 字段与响应形状的唯一依据：api-contract.md（2.2 响应形状 / 2.6 空值 / 4.3 A2 / 4.5 A4 / 4.7 A6）。
// 代码与文档冲突时以文档为准。
//
// 关于 A6 的「防重复」：契约约定的是 **覆盖保存（upsert）**，不是拒绝。
//   同一天再打卡一次 = 覆盖那天的记录，响应里 isNew:false，前端据此显示「已更新今日记录」。
//   兜底是数据库的 UNIQUE (user_id, date) —— 一天只可能有一条，插不出第二条。
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

// A4 的条数上限：limit 参数的取值范围（契约 4.5）
const MAX_LIMIT = 1000;

// 错误码字典：前端按 code 分支，message 是给人看的中文口语短句（契约 2.2 / 2.3）
const ERR = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_PARAM: "INVALID_PARAM",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  DB_ERROR: "DB_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

// CORS 响应头。
//
// 注意（2026-10-02 实测踩坑）：**不要自己写 "Access-Control-Allow-Origin"**。
// CloudBase 的 HTTP 网关（响应头里 server: tcbgw）会自己回跨域头，并且回的是
//   access-control-allow-credentials: true
//   access-control-allow-origin: <请求的 Origin>
// 我们若再写一个 "*"，网关会把两者拼成 "http://xxx,*"（带 credentials 时 Allow-Origin
// 不允许是 "*"，更不允许逗号多值）→ 浏览器判定跨域失败，前端报 "Failed to fetch"。
// 所以这里只保留方法/请求头两项，Allow-Origin 交给网关。
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

// 数据库读写失败 → 500 DB_ERROR（契约 2.3）。真实错误只进云端日志，不回给前端。
// message 可覆盖：读失败说"取不出来"，写失败说"没存上"，都比一句笼统的"出错了"好懂。
function sendDbError(res, where, error, message = "记录暂时取不出来，稍后再试") {
  console.error(`[api-health] ${where} 访问数据库失败:`, error);
  return sendFail(res, 500, ERR.DB_ERROR, message);
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
// 请求体读取（A6）
// ---------------------------------------------------------------------------

// 单日记录再长也就几百字节，64KB 是个宽松的上限；超过就直接拒绝，不给内存压力。
const MAX_BODY_BYTES = 64 * 1024;

// 读出请求体并解析成 JSON 对象。
// 返回 { value } 或 { bad: "parse" }（体积超限同理当作解析失败，前端只需要知道"体不对"）。
// 空请求体按 {} 处理 —— 交给字段校验去说"什么都没填"，错误信息比"body 是空的"更有用。
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve({ bad: "parse" });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") return resolve({ value: {} });
      try {
        resolve({ value: JSON.parse(raw) });
      } catch (e) {
        resolve({ bad: "parse" });
      }
    });

    req.on("error", () => resolve({ bad: "parse" }));
  });
}

// ---------------------------------------------------------------------------
// 字段校验（A6 · 契约 4.7 + 3.2）
// ---------------------------------------------------------------------------
// 规则与前端 assets/js/validate.js 一一对应，文案也刻意保持一致：
// 前端红字和后端 400 的 message 说的是同一句话，用户在哪一层被拦都看到同样的提示。
// 后端**必须**自己再跑一遍 —— 前端校验只为体验，绕过前端直接发请求是挡不住的。

// 枚举值必须与 db/schema.sql 的 CHECK 约束一致
const EXERCISE_TYPES = ["散步", "慢跑", "跳绳", "骑行", "力量训练", "瑜伽"];
const MEAL_TAGS = ["健康", "普通", "放纵"];

// 三餐三件套：API 字段名 ↔ 数据库列名 ↔ 给用户看的称谓
const MEALS = [
  { textKey: "mealBreakfastText", tagKey: "mealBreakfastTag", textCol: "meal_breakfast_text", tagCol: "meal_breakfast_tag", label: "早餐" },
  { textKey: "mealLunchText", tagKey: "mealLunchTag", textCol: "meal_lunch_text", tagCol: "meal_lunch_tag", label: "午餐" },
  { textKey: "mealDinnerText", tagKey: "mealDinnerTag", textCol: "meal_dinner_text", tagCol: "meal_dinner_tag", label: "晚餐" },
];

function fieldError(field, message) {
  return { error: { code: ERR.VALIDATION_ERROR, field, message } };
}

// 数字解析：接受 number，或能整段解析成数字的字符串（表单里常见 "30"）。
// 返回 null = 没填；返回 NaN = 填了但不是数字（调用方据此报 400）。
function parseNum(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return NaN;
}

// 文字解析：只认字符串和空值。数字/布尔/对象/数组一律判错 ——
// 否则一个对象会被 String() 存成 "[object Object]"，问题藏进数据库里更难查。
function parseText(v) {
  if (v === undefined || v === null || v === "") return { value: "" };
  if (typeof v === "string") return { value: v.trim() };
  return { bad: true };
}

// 空值统一转 null：数据库列是 INTEGER / NUMERIC / TEXT，存不下空字符串（契约 3.4 空值分工）
function blankToNull(v) {
  return v === "" ? null : v;
}

// 校验单日记录。
// 通过 → { values }：键已是数据库列名，没填的一律 null，可直接拼进写库语句。
// 不过 → { error: { code, field, message } }：第一条不合格的字段就返回，字段顺序即表单从上到下的顺序。
function validateCheckin(raw) {
  const values = {};

  // ---- 运动 ----
  const type = parseText(raw.exerciseType);
  if (type.bad) return fieldError("exerciseType", "运动类型要写成文字");
  if (type.value !== "" && !EXERCISE_TYPES.includes(type.value)) {
    return fieldError("exerciseType", `运动类型只能是：${EXERCISE_TYPES.join(" / ")}`);
  }
  values.exercise_type = blankToNull(type.value);

  const minutes = parseNum(raw.exerciseMinutes);
  if (Number.isNaN(minutes) || (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 600))) {
    return fieldError("exerciseMinutes", "时长要填 0~600 的整数分钟");
  }
  values.exercise_minutes = minutes;

  // 卡路里由前端 calories.js 算好随请求提交，后端只验范围、不重算（TECH_DESIGN 3.7 第 5 条）
  const calories = parseNum(raw.exerciseCalories);
  if (Number.isNaN(calories) || (calories !== null && (!Number.isInteger(calories) || calories < 0 || calories > 9999))) {
    return fieldError("exerciseCalories", "卡路里要填 0~9999 的整数");
  }
  values.exercise_calories = calories;

  const weight = parseNum(raw.weightKg);
  if (Number.isNaN(weight)) return fieldError("weightKg", "体重要填 30~200 kg 之间的数");
  if (weight !== null) {
    if (weight < 30 || weight > 200) return fieldError("weightKg", "体重要填 30~200 kg 之间的数");
    // NUMERIC(4,1) 会把多余小数位四舍五入（65.55 → 65.6），所以在这里挡住，别让用户填了却被偷偷改数
    if (Math.round(weight * 10) !== weight * 10) return fieldError("weightKg", "体重最多填一位小数");
  }
  values.weight_kg = weight;

  const water = parseNum(raw.waterMl);
  if (Number.isNaN(water) || (water !== null && (!Number.isInteger(water) || water < 0 || water > 10000))) {
    return fieldError("waterMl", "饮水量要填 0~10000 的整数 ml");
  }
  values.water_ml = water;

  // ---- 三餐 ----
  // 「至少有一项内容」只认用户真正填的东西：运动（类型/时长）、三餐、体重、饮水。
  // 卡路里是自动算出来的，单独有值不算"记了东西"（契约 4.7 第 1 条，PRD E3）。
  let hasContent = type.value !== "" || minutes !== null || weight !== null || water !== null;

  for (const meal of MEALS) {
    const text = parseText(raw[meal.textKey]);
    if (text.bad) return fieldError(meal.textKey, `${meal.label}吃了什么要写成文字`);
    if (text.value.length > 100) return fieldError(meal.textKey, "一句话就好，100 字以内");

    const tag = parseText(raw[meal.tagKey]);
    if (tag.bad) return fieldError(meal.tagKey, `${meal.label}标签要写成文字`);
    if (tag.value !== "" && !MEAL_TAGS.includes(tag.value)) {
      return fieldError(meal.tagKey, `${meal.label}标签只能是：健康 / 普通 / 放纵`);
    }

    values[meal.textCol] = blankToNull(text.value);
    values[meal.tagCol] = blankToNull(tag.value);
    if (text.value !== "" || tag.value !== "") hasContent = true;
  }

  if (!hasContent) {
    return fieldError("record", "这一天还什么都没填，先记一项再保存吧");
  }

  return { values };
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

  // limit 校验（同样放在查库之前）
  const limitRaw = params.get("limit");
  let limit = null;
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw)) {
      return sendFail(res, 400, ERR.INVALID_PARAM, "limit 要填正整数，比如 30");
    }
    limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) {
      return sendFail(res, 400, ERR.INVALID_PARAM, `limit 取值范围是 1~${MAX_LIMIT}`);
    }
  }

  // 参数化：日期和条数都是作为「结构化参数」传给 SDK 的，不会被拼进查询语句，
  // 所以 from / to / limit 里塞什么都改不了查询本身（这就是防注入）。
  let query = getDb().from("checkins").select("*").eq("user_id", USER_ID);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  // 带 limit 时先倒序取「最新 N 条」，下面再翻回升序 —— 这样 ?limit=30 才等于直觉里的「最近 30 天」。
  // 不带 limit 直接升序（趋势图按顺序连线，契约 4.5 的硬约定）。
  let ordered = query.order("date", { ascending: limit === null });
  if (limit !== null) ordered = ordered.limit(limit);

  const { data, error } = await ordered;
  if (error) return sendDbError(res, "GET /api/checkins", error);

  const items = (Array.isArray(data) ? data : []).map(checkinToApi);
  // 翻回升序，保证对外 items 永远从早到晚
  if (limit !== null) items.reverse();
  // 没有记录时回空数组 + total: 0，这是正常状态不是错误（契约 4.5）
  return sendOk(res, { items, total: items.length });
}

// A6 · PUT /api/checkins/{date} —— 保存 / 覆盖单日记录（契约 4.7）
//
// 执行顺序「先校验、后写库」，任何一格没通过就原样退回，绝不半截写进去：
//   ① 路径日期格式 → ② 请求体是不是 JSON 对象 → ③ 请求体里的 date 是否与路径一致
//   → ④ 11 个字段逐个校验 → ⑤「至少有一项内容」→ ⑥ 写库
async function handlePutCheckin(res, date, req) {
  // ① 路径参数：全链路只认 YYYY-MM-DD，且必须是真实存在的日期
  if (!isDateStr(date)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "地址里的日期格式不对，应该写成 2026-09-21 这样");
  }

  // ② 请求体（空体按 {} 处理，让第 ⑤ 步去说"什么都没填"）
  const body = await readJsonBody(req);
  const raw = body.bad ? null : body.value;
  if (body.bad) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体不是合法的 JSON，检查一下格式", "record");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体要是一个 JSON 对象，比如 {\"waterMl\": 1800}", "record");
  }

  // ③ 日期以路径为准；请求体里若也带了 date，必须与路径一致（契约 4.7）
  if (!(raw.date === undefined || raw.date === null || raw.date === "")) {
    if (dateOnly(raw.date) !== date) {
      return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体里的日期和地址里的日期对不上", "date");
    }
  }

  // ④⑤ 字段校验
  const checked = validateCheckin(raw);
  if (checked.error) {
    return sendFail(res, 400, checked.error.code, checked.error.message, checked.error.field);
  }

  // ⑥-a 先看这天有没有记录 —— 决定返回 isNew（新建 / 覆盖），契约 4.7 的成功响应里要它
  const { data: existingRows, error: readError } = await getDb()
    .from("checkins")
    .select("date")
    .eq("user_id", USER_ID)
    .eq("date", date)
    .limit(1);
  if (readError) return sendDbError(res, "PUT /api/checkins 查重", readError);
  const isNew = !(Array.isArray(existingRows) ? existingRows.length > 0 : existingRows);

  // ⑥-b 覆盖保存：INSERT ... ON CONFLICT (user_id, date) DO UPDATE，一条语句搞定新建和覆盖。
  //   冲突键必须写 (user_id, date)，并且 user_id 必须是 0 而不是 NULL ——
  //   PG 里 NULL 互不相等，冲突不会发生，同一天会插出第二条记录（契约 4.7 实现要点）。
  //   updated_at 在这里显式给值（故意的，不用触发器：规则留在代码里一眼能看见）。
  const { data: savedRows, error: writeError } = await getDb()
    .from("checkins")
    .upsert(
      { ...checked.values, user_id: USER_ID, date, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date" }
    )
    .select();
  if (writeError) return sendDbError(res, "PUT /api/checkins 写库", writeError, "记录没存上，稍后再试一次");

  // ⑥-c 拿"保存之后的样子"作为响应：优先用写库直接回传的那行；
  //   万一网关没把 representation 带回来，就补一次读 —— 响应里必须有完整记录，这是契约 4.7 的规定。
  let saved = Array.isArray(savedRows) ? savedRows[0] : savedRows;
  if (!saved) {
    const { data: afterRows, error: afterError } = await getDb()
      .from("checkins")
      .select("*")
      .eq("user_id", USER_ID)
      .eq("date", date)
      .limit(1);
    if (afterError) return sendDbError(res, "PUT /api/checkins 回读", afterError, "记录存下了但没能读回来，刷新页面看看");
    saved = Array.isArray(afterRows) ? afterRows[0] : afterRows;
  }
  if (!saved) {
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "记录没存上，稍后再试一次");
  }

  return sendOk(res, { saved: true, isNew, record: checkinToApi(saved) });
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
