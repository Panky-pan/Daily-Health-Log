// handlers/checkins.js —— A4 · GET /api/checkins、A6 · PUT /api/checkins/{date}
//
// 本层的职责边界：解析请求参数 → 校验 → 调 repository → 把结果包装成响应。
// 这里不出现任何数据库查询语句（那是 repositories/ 的事），也不写字段校验规则（那是 validators/ 的事）。

const { sendOk, sendFail, sendDbError } = require("../lib/response");
const { ERR } = require("../lib/errors");
const { MAX_RANGE_DAYS, MAX_LIMIT } = require("../lib/config");
const { isDateStr, daysBetween } = require("../lib/dates");
const { readJsonBody } = require("../lib/body");
const { checkinToApi, dateOnly } = require("../lib/mappers");
const { validateCheckin } = require("../validators/checkin.validator");
const checkinsRepo = require("../repositories/checkins.repository");

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

  // repository 回来的一定是从早到晚（升序），limit 的「取最近 N 天」也在那边处理完了
  const { rows, error } = await checkinsRepo.findAll({ from, to, limit });
  if (error) return sendDbError(res, "GET /api/checkins", error);

  const items = rows.map(checkinToApi);
  // 没有记录时回空数组 + total: 0，这是正常状态不是错误（契约 4.5）
  return sendOk(res, { items, total: items.length });
}

// A6 · PUT /api/checkins/{date} —— 保存 / 覆盖单日记录（契约 4.7）
//
// 执行顺序「先校验、后写库」，任何一格没通过就原样退回，绝不半截写进去：
//   ① 路径日期格式 → ② 请求体是不是 JSON 对象 → ③ 请求体里的 date 是否与路径一致
//   → ④ 11 个字段逐个校验 → ⑤「至少有一项内容」→ ⑥ 写库
//
// 关于「防重复」：契约约定的是 **覆盖保存（upsert）**，不是拒绝。
//   同一天再打卡一次 = 覆盖那天的记录，响应里 isNew:false，前端据此显示「已更新今日记录」。
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
  const { exists, error: readError } = await checkinsRepo.existsByDate(date);
  if (readError) return sendDbError(res, "PUT /api/checkins 查重", readError);
  const isNew = !exists;

  // ⑥-b 覆盖保存（repository 里是 upsert，冲突键 user_id,date）
  const { row: savedRow, error: writeError } = await checkinsRepo.saveCheckin(checked.values, date);
  if (writeError) return sendDbError(res, "PUT /api/checkins 写库", writeError, "记录没存上，稍后再试一次");

  // ⑥-c 拿"保存之后的样子"作为响应：优先用写库直接回传的那行；
  //   万一网关没把 representation 带回来，就补一次读 —— 响应里必须有完整记录，这是契约 4.7 的规定。
  let saved = savedRow;
  if (!saved) {
    const { row: afterRow, error: afterError } = await checkinsRepo.findByDate(date);
    if (afterError) return sendDbError(res, "PUT /api/checkins 回读", afterError, "记录存下了但没能读回来，刷新页面看看");
    saved = afterRow;
  }
  if (!saved) {
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "记录没存上，稍后再试一次");
  }

  return sendOk(res, { saved: true, isNew, record: checkinToApi(saved) });
}

module.exports = { handleListCheckins, handlePutCheckin };
