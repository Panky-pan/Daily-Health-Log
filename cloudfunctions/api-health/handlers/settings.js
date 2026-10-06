// handlers/settings.js —— A2 · GET /api/settings、A3 · PUT /api/settings
//
// 接请求 → 调 repository → 返响应，三件事，没别的。

const { sendOk, sendFail, sendDbError } = require("../lib/response");
const { ERR } = require("../lib/errors");
const { todayStr } = require("../lib/dates");
const { readJsonBody } = require("../lib/body");
const { settingsToApi, dateOnly } = require("../lib/mappers");
const { validateSettings } = require("../validators/settings.validator");
const settingsRepo = require("../repositories/settings.repository");

async function handleGetSettings(res) {
  const { row, error } = await settingsRepo.getSettings();

  if (error) return sendDbError(res, "GET /api/settings", error);

  // 还没设置过 → 200 + settings: null（不是 404，契约 4.3）
  return sendOk(res, { settings: row ? settingsToApi(row) : null });
}

// A3 · PUT /api/settings —— 存 / 改目标设置（契约 4.4）
//
// 统一 upsert，不区分「新建」和「更新」两种语义：单人场景只有一条设置，
// 前端不必判断该调 POST 还是 PUT（和 A6 同一个取舍）。
//
// startDate 的三条规则（契约 3.3）全在第 ③ 步落地：
//   ① 首次创建：请求带了 startDate 就用它，没带就取服务器当天（北京时区）；
//   ② 记录已存在：原样保留，请求里带了也不改 —— 实现方式是"把库里的原值传回去"，
//      详见 repositories/settings.repository.js 里 start_date 必须每次都带上的原因；
//   ③ 前端不必操心，照常提交两个目标值即可。
async function handlePutSettings(res, req) {
  // ① 请求体（空体按 {} 处理，让校验层去说"两个目标都要填"）
  const body = await readJsonBody(req);
  const raw = body.bad ? null : body.value;
  if (body.bad) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体不是合法的 JSON，检查一下格式", "settings");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return sendFail(res, 400, ERR.VALIDATION_ERROR, "请求体要是一个 JSON 对象，比如 {\"goalExerciseMinutes\": 30, \"goalWaterMl\": 2000}", "settings");
  }

  // ② 两个目标值逐个校验
  const checked = validateSettings(raw);
  if (checked.error) {
    return sendFail(res, 400, checked.error.code, checked.error.message, checked.error.field);
  }

  // ③ startDate 的三条规则（契约 3.3）在这里落地。
  //    先看设置存不存在 —— 决定 start_date 该给什么值。
  const { row: existing, error: readError } = await settingsRepo.getSettings();
  if (readError) return sendDbError(res, "PUT /api/settings 查现状", readError);

  // 已存在 → 把库里的原值原样传回去（值没变，坚持率分母就不受影响，这就是"永不覆盖"）
  // 首次   → 请求带了 startDate 就用它，没带就取服务器当天（北京时区，见 lib/dates.js）
  const startDate = existing
    ? dateOnly(existing.start_date)
    : checked.values.start_date || todayStr();

  // ④ 写库（upsert，冲突键 user_id）
  const { row: saved, error: writeError } = await settingsRepo.saveSettings(checked.values, startDate);
  if (writeError) return sendDbError(res, "PUT /api/settings 写库", writeError, "设置没存上，稍后再试一次");

  // ⑤ 拿"保存之后的样子"作为响应（契约 4.4：返回保存后的完整设置，前端可直接刷新界面）
  let result = saved;
  if (!result) {
    const { row: afterRow, error: afterError } = await settingsRepo.getSettings();
    if (afterError) return sendDbError(res, "PUT /api/settings 回读", afterError, "设置存下了但没能读回来，刷新页面看看");
    result = afterRow;
  }
  if (!result) {
    return sendFail(res, 500, ERR.INTERNAL_ERROR, "设置没存上，稍后再试一次");
  }

  return sendOk(res, { settings: settingsToApi(result) });
}

module.exports = { handleGetSettings, handlePutSettings };
