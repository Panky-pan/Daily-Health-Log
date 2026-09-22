/* ============================================
   validate.js —— 字段校验规则（PRD E5 / 验收 B3）
   数值范围与 TECH_DESIGN 2.4 对照表一致：
   体重 30~200kg、时长 0~600 分钟、饮水 0~10000ml、整数须非负。
   每个校验函数返回：
   { ok: true,  value: 规范化后的值 }  或
   { ok: false, value: '', message: 给用户看的红字文案 }
   ============================================ */

(function () {
  'use strict';

  // 通用：把输入转成数字；空值直接放行（部分填写是允许的，E3）
  function toNumber(input) {
    if (input === '' || input === null || input === undefined) return null;
    return Number(input);
  }

  // 运动时长：非负整数，0~600 分钟
  function exerciseMinutes(input) {
    var n = toNumber(input);
    if (n === null) return { ok: true, value: '' };
    if (!Number.isInteger(n) || n < 0 || n > 600) {
      return { ok: false, value: '', message: '时长要填 0~600 的整数分钟' };
    }
    return { ok: true, value: n };
  }

  // 体重：30~200kg，允许一位小数
  function weightKg(input) {
    var n = toNumber(input);
    if (n === null) return { ok: true, value: '' };
    if (!isFinite(n) || n < 30 || n > 200) {
      return { ok: false, value: '', message: '体重要填 30~200 kg 之间的数' };
    }
    if (Math.round(n * 10) !== n * 10) {
      return { ok: false, value: '', message: '体重最多填一位小数' };
    }
    return { ok: true, value: n };
  }

  // 饮水：非负整数，0~10000 ml
  function waterMl(input) {
    var n = toNumber(input);
    if (n === null) return { ok: true, value: '' };
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      return { ok: false, value: '', message: '饮水量要填 0~10000 的整数 ml' };
    }
    return { ok: true, value: n };
  }

  // 三餐「吃了什么」：一句话，最多 100 字，前后空格去掉
  function mealText(input) {
    var t = String(input === null || input === undefined ? '' : input).trim();
    if (t.length > 100) {
      return { ok: false, value: '', message: '一句话就好，100 字以内' };
    }
    return { ok: true, value: t };
  }

  window.dhlValidate = {
    exerciseMinutes: exerciseMinutes,
    weightKg: weightKg,
    waterMl: waterMl,
    mealText: mealText
  };
})();
