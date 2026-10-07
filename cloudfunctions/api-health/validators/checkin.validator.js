// validators/checkin.validator.js —— A6 请求体的字段校验（契约 4.7 + 3.2）
//
// 规则与前端 assets/js/validate.js 一一对应，文案也刻意保持一致：
// 前端红字和后端 400 的 message 说的是同一句话，用户在哪一层被拦都看到同样的提示。
// 后端**必须**自己再跑一遍 —— 前端校验只为体验，绕过前端直接发请求是挡不住的。
//
// 这一层不碰数据库、不碰 HTTP，只做「值合不合格」一件事。

const { ERR } = require("../lib/errors");

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

// PATCH 局部校验：只校验请求体里出现的字段（契约 4.9 A8）。
//
// 与 validateCheckin 的区别：
//   A6 要求 11 个字段都在请求体里（缺的按 null 写库）；
//   PATCH 只改请求体里出现的字段，没出现的不动。
//   "至少要改一个字段"和 A6 的"至少有一项内容"语义不同 —— A6 全空 = 啥也没记，
//   PATCH 收到空体或只有 date = 没说要改什么。
//
// 入参：raw 是请求体对象（已由 handler 确认是 JSON 对象）
// 出参：{ values } 或 { error: { code, field, message } }
//   values 的键是数据库列名，只包含 raw 里出现的字段（date 不在 values 里 —— date 是路径参数）。
function validateCheckinPatch(raw) {
  const values = {};
  let hasPatch = false;  // 至少改了一个可改字段（date 不算）

  // date 不在可改字段里 —— 路径参数说了算。允许出现在请求体里，
  // 与路径一致性校验由 handler 做（同 A6），这里只跳过。

  // 运动：三个字段互相独立，出现哪个校验哪个
  if (raw.exerciseType !== undefined) {
    const type = parseText(raw.exerciseType);
    if (type.bad) return fieldError("exerciseType", "运动类型要写成文字");
    if (type.value !== "" && !EXERCISE_TYPES.includes(type.value)) {
      return fieldError("exerciseType", `运动类型只能是：${EXERCISE_TYPES.join(" / ")}`);
    }
    values.exercise_type = blankToNull(type.value);
    hasPatch = true;
  }

  if (raw.exerciseMinutes !== undefined) {
    const minutes = parseNum(raw.exerciseMinutes);
    if (Number.isNaN(minutes) || (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 600))) {
      return fieldError("exerciseMinutes", "时长要填 0~600 的整数分钟");
    }
    values.exercise_minutes = minutes;
    hasPatch = true;
  }

  if (raw.exerciseCalories !== undefined) {
    const calories = parseNum(raw.exerciseCalories);
    if (Number.isNaN(calories) || (calories !== null && (!Number.isInteger(calories) || calories < 0 || calories > 9999))) {
      return fieldError("exerciseCalories", "卡路里要填 0~9999 的整数");
    }
    values.exercise_calories = calories;
    hasPatch = true;
  }

  if (raw.weightKg !== undefined) {
    const weight = parseNum(raw.weightKg);
    if (Number.isNaN(weight)) return fieldError("weightKg", "体重要填 30~200 kg 之间的数");
    if (weight !== null) {
      if (weight < 30 || weight > 200) return fieldError("weightKg", "体重要填 30~200 kg 之间的数");
      if (Math.round(weight * 10) !== weight * 10) return fieldError("weightKg", "体重最多填一位小数");
    }
    values.weight_kg = weight;
    hasPatch = true;
  }

  if (raw.waterMl !== undefined) {
    const water = parseNum(raw.waterMl);
    if (Number.isNaN(water) || (water !== null && (!Number.isInteger(water) || water < 0 || water > 10000))) {
      return fieldError("waterMl", "饮水量要填 0~10000 的整数 ml");
    }
    values.water_ml = water;
    hasPatch = true;
  }

  // 三餐：text 和 tag 各自独立，出现哪个改哪个
  for (const meal of MEALS) {
    if (raw[meal.textKey] !== undefined) {
      const text = parseText(raw[meal.textKey]);
      if (text.bad) return fieldError(meal.textKey, `${meal.label}吃了什么要写成文字`);
      if (text.value.length > 100) return fieldError(meal.textKey, "一句话就好，100 字以内");
      values[meal.textCol] = blankToNull(text.value);
      hasPatch = true;
    }
    if (raw[meal.tagKey] !== undefined) {
      const tag = parseText(raw[meal.tagKey]);
      if (tag.bad) return fieldError(meal.tagKey, `${meal.label}标签要写成文字`);
      if (tag.value !== "" && !MEAL_TAGS.includes(tag.value)) {
        return fieldError(meal.tagKey, `${meal.label}标签只能是：健康 / 普通 / 放纵`);
      }
      values[meal.tagCol] = blankToNull(tag.value);
      hasPatch = true;
    }
  }

  if (!hasPatch) {
    return fieldError("record", "至少要改一个字段");
  }

  return { values };
}

module.exports = { validateCheckin, validateCheckinPatch, EXERCISE_TYPES, MEAL_TAGS };
