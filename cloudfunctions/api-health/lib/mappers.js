// lib/mappers.js —— 字段转换：数据库 snake_case + NULL  →  API camelCase + ""
//
// 契约 2.6：用户没填的字段回 "" 而不是 null（否则前端会渲染出 "null kg"）。
// 数据库那边存的是 NULL（契约 3.4 的空值分工），转换只在这一层做一次。
// 所有接口的行 → 对象转换都从这里走，别在 handler 里再写一遍。

// 文字字段：有值转字符串，没值回 ""
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

module.exports = { text, num, dateOnly, checkinToApi, settingsToApi };
