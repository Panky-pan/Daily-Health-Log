// validators/settings.validator.js —— A3 请求体的字段校验（契约 4.4 + 3.3）
//
// 与 checkin.validator.js 同源的思路：只做「值合不合格」，不碰数据库、不碰 HTTP。
// 文案也刻意跟前端 assets/js 里保存目标的提示对齐，用户在哪一层被拦都看到同一句话。
// 后端**必须**自己再跑一遍 —— 前端校验只为体验，绕过前端直接发请求是挡不住的。
//
// 与单日记录校验最大的不同：这里的两个字段**都是必填**（契约 4.4），
// 所以「没填」和「填错了」在这里是同一件事：不合格。

const { ERR } = require("../lib/errors");
const { isDateStr } = require("../lib/dates");

function fieldError(field, message) {
  return { error: { code: ERR.VALIDATION_ERROR, field, message } };
}

// 整数解析：接受 number 或整段数字的字符串（表单里常见 "30"）。
// 返回 NaN = 不合格：缺失、null、空串、小数（30.5）、文字都算。
function parseIntStrict(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : NaN;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

// 校验目标设置。
// 通过 → { values }：键已是数据库列名，可直接拼进写库语句
//       （start_date 允许为 null，由 handler 决定是取请求值还是服务器当天）
// 不过 → { error: { code, field, message } }：第一个不合格的字段就返回
function validateSettings(raw) {
  const values = {};

  // 每日运动目标：1~600 整数（契约 4.4，与 settings_goal_exercise_minutes_check 同范围）
  const minutes = parseIntStrict(raw.goalExerciseMinutes);
  if (Number.isNaN(minutes) || minutes < 1 || minutes > 600) {
    return fieldError("goalExerciseMinutes", "运动目标要填 1~600 的整数分钟");
  }
  values.goal_exercise_minutes = minutes;

  // 每日饮水目标：1~10000 整数
  const water = parseIntStrict(raw.goalWaterMl);
  if (Number.isNaN(water) || water < 1 || water > 10000) {
    return fieldError("goalWaterMl", "饮水目标要填 1~10000 的整数 ml");
  }
  values.goal_water_ml = water;

  // startDate 可选（契约 4.4 标"否"）：带了就必须是合法日期。
  // 注意它"什么时候才真的写进库"由 handler 判断（首次创建才写，之后永不覆盖），
  // 校验层只管这次给的值合不合格。
  if (raw.startDate === undefined || raw.startDate === null || raw.startDate === "") {
    values.start_date = null;
  } else if (isDateStr(raw.startDate)) {
    values.start_date = raw.startDate;
  } else {
    return fieldError("startDate", "开始日期格式不对，应该写成 2026-09-21 这样");
  }

  return { values };
}

module.exports = { validateSettings };
