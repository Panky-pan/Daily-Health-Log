// handlers/checkins.js —— A4 · GET /api/checkins、A6 · PUT /api/checkins/{date}、A8 · PATCH /api/checkins/{date}、A9 · DELETE /api/checkins/{date}
//
// 本层的职责边界：解析请求参数 → 校验 → 调 repository → 把结果包装成响应。
// 这里不出现任何数据库查询语句（那是 repositories/ 的事），也不写字段校验规则（那是 validators/ 的事）。

const { sendOk, sendFail, sendDbError } = require("../lib/response");
const { ERR } = require("../lib/errors");
const { MAX_RANGE_DAYS, MAX_LIMIT } = require("../lib/config");
const { isDateStr, daysBetween } = require("../lib/dates");
const { readJsonBody } = require("../lib/body");
const { checkinToApi, dateOnly } = require("../lib/mappers");
const { validateCheckin, validateCheckinPatch } = require("../validators/checkin.validator");
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

// A5 · GET /api/checkins/{date} —— 读单日记录（契约 4.6）
//
// 为什么「那天没记录」回 200 + record:null 而不是 404：
//   「那天没打卡」是正常业务状态，不是错误（和 A2 的 settings:null 同一个理由）；
//   而且 404 在本项目里已经被「路径不存在」占用了，混用前端没法区分。
async function handleGetCheckin(res, date) {
  // 路径参数先校验：日期格式错就没必要去打扰数据库（和 A4 一样的做法）
  if (!isDateStr(date)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "地址里的日期格式不对，应该写成 2026-09-21 这样");
  }

  // 仓库层的 findByDate 是 A6 写完回读时用的那一个，这里直接复用，不新增查询代码
  const { row, error } = await checkinsRepo.findByDate(date);
  if (error) return sendDbError(res, "GET /api/checkins/{date}", error);

  // record 为 null = 那天确实没打卡（不是错误）；有记录时字段转换与 A4 走同一个映射
  return sendOk(res, { record: row ? checkinToApi(row) : null });
}

// A8 · PATCH /api/checkins/{date} —— 局部修改单日记录（契约 4.9）
//
// 与 A6 PUT 的核心区别：
//   A6 是「PUT 全量覆盖」—— 11 个字段都写一遍，缺的写 NULL，是同一天的整条替换；
//   PATCH 是「局部修改」—— 只 UPDATE 请求体里出现的列，没出现的不动。
//   "至少要改一个字段"（PATCH）和"至少有一项内容"（A6）语义不同：
//     A6 全空 = 啥也没记，回 400「先记一项再保存」；
//     PATCH 收到空体或只有 date = 没说要改什么，回 400「至少要改一个字段」。
//
// 执行顺序「先校验、后写库」，与 A6 同款：
//   ① 路径日期格式 → ② 请求体是不是 JSON 对象 → ③ 请求体里的 date 是否与路径一致
//   → ④ 字段局部校验 → ⑤ 查存在 → ⑥ 写库 → ⑦ 回读
//
// 关于「不存在返 404」：PATCH 改的是「已有的记录」，那天没记录 = 目标资源不存在，
//   与 A5「读不到那天记录返 record:null」的 200 不同 —— 读是查询、改是状态变更，
//   改一个不存在的目标属于"目标不存在"，404 + 中文比 200 + 假成功更诚实。
async function handlePatchCheckin(res, date, req) {
  // ① 路径参数
  if (!isDateStr(date)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "地址里的日期格式不对，应该写成 2026-09-21 这样");
  }

  // ② 请求体（空体按 {} 处理，让第 ④ 步去说"什么都没要改"）
  const body = await readJsonBody(req);
  if (body.bad) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体不是合法的 JSON，检查一下格式", "record");
  }
  const raw = body.value;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体要是一个 JSON 对象，比如 {\"weightKg\": 66}", "record");
  }

  // ③ 日期以路径为准；请求体里若也带了 date，必须与路径一致（同 A6 的规矩）
  if (!(raw.date === undefined || raw.date === null || raw.date === "")) {
    if (dateOnly(raw.date) !== date) {
      return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体里的日期和地址里的日期对不上", "date");
    }
  }

  // ④ 局部校验：只校验出现的字段，至少要改一个（date 不算）
  const checked = validateCheckinPatch(raw);
  if (checked.error) {
    return sendFail(res, 400, checked.error.code, checked.error.message, checked.error.field);
  }

  // ⑤ 查存在：那天没记录返 404，PATCH 改的是已有记录
  const { exists, error: readError } = await checkinsRepo.existsByDate(date);
  if (readError) return sendDbError(res, "PATCH /api/checkins 查重", readError);
  if (!exists) {
    return sendFail(res, 404, ERR.NOT_FOUND, `${date} 那天没有打卡记录，先去打卡页建一条再改`);
  }

  // ⑥ 写库（只改指定列，updated_at 显式刷新；created_at 不在 UPDATE 范围，自然保持）
  const { row: patchedRow, error: writeError } = await checkinsRepo.patchCheckin(checked.values, date);
  if (writeError) return sendDbError(res, "PATCH /api/checkins 写库", writeError, "记录没改上，稍后再试一次");

  // ⑦ 拿"改之后的样子"作为响应：优先用写库直接回传的行，兜底补一次读
  let saved = patchedRow;
  if (!saved) {
    const { row: afterRow, error: afterError } = await checkinsRepo.findByDate(date);
    if (afterError) return sendDbError(res, "PATCH /api/checkins 回读", afterError, "记录改下了但没能读回来，刷新页面看看");
    saved = afterRow;
  }
  if (!saved) {
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "记录没改上，稍后再试一次");
  }

  return sendOk(res, { patched: true, record: checkinToApi(saved) });
}

// A9 · DELETE /api/checkins/{date} —— 删除单日记录（契约 4.10）
//
// 与 A6/A8 的区别：DELETE 无请求体、无字段校验，只看路径日期 + 是否存在。
//   那天没记录返 404 + 中文（同 PATCH 的理由：删一个不存在的目标 = 目标不存在）。
//   成功返 {ok:true,data:{date,deleted:true}}，不回 record —— 删了就是删了，没必要再回那条记录。
//
// 关于「不可恢复」：DELETE 是真删，前端必须二次确认（AGENTS.md 第八条第 5 项：
//   涉及数据删除的功能页面上必须做二次确认，代码注释里写明「此操作不可恢复」）。
//   **此操作不可恢复** —— 删掉的那天记录 created_at/updated_at 一起没了，
//   无法通过日志找回，只能用 A6 PUT 重新写一条（但 created_at 会变成新的时间）。
async function handleDeleteCheckin(res, date) {
  // ① 路径参数
  if (!isDateStr(date)) {
    return sendFail(res, 400, ERR.INVALID_PARAM, "地址里的日期格式不对，应该写成 2026-09-21 这样");
  }

  // ② 查存在：那天没记录返 404 + 中文（不返 200 + deleted:false，因为「目标不存在」更诚实）
  const { exists, error: readError } = await checkinsRepo.existsByDate(date);
  if (readError) return sendDbError(res, "DELETE /api/checkins 查重", readError);
  if (!exists) {
    return sendFail(res, 404, ERR.NOT_FOUND, `${date} 那天没有打卡记录，删不了`);
  }

  // ③ 删（**此操作不可恢复**，前端必须二次确认后才发请求）
  const { error: deleteError } = await checkinsRepo.deleteByDate(date);
  if (deleteError) return sendDbError(res, "DELETE /api/checkins 删除", deleteError, "记录没删掉，稍后再试一次");

  // ④ 返响应：不回 record，只确认删了哪天
  return sendOk(res, { date, deleted: true });
}

module.exports = { handleListCheckins, handleGetCheckin, handlePutCheckin, handlePatchCheckin, handleDeleteCheckin };
