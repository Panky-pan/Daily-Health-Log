/* ============================================
   mock.js —— 开屏页的「假数据 + 假装取数」
   ------------------------------------------------------------
   这一版页面的完成标准是「用本地假数据渲染」，所以不看真实接口
   （接真 API 是第 3 周的事）。假数据全部在这里。

   两条硬约定：
   1. 假数据的形状必须和将来真接口返回的一模一样 —— 字段沿用
      TECH_DESIGN 2.2 的单日记录命名（camelCase）。这样第 3 周接 API 时，
      只改本文件的 fetchPreview()，landing.js 一行都不用动。
   2. 取数一律走 fetchPreview()，它永远返回 Promise（成功 resolve / 失败 reject）。
      Promise 就是「这件事现在还没有结果，结果早晚会来」的写法。
      真实网络请求是异步的，本地数据是同步的 —— 用 Promise 统一成同一个形状，
      将来把里面的 setTimeout 换成 fetch 就行。

   四种状态的调试入口（写在地址栏里）：
     welcome.html?state=loading   停在加载中
     welcome.html?state=empty     取到空数据
     welcome.html?state=error     取数失败
     welcome.html                 正常有数据（默认）
   ============================================ */

(function () {
  'use strict';

  // 假装网络花了 700 毫秒。
  // 这个延迟是故意的：本地数据瞬间就返回，不留一点延迟的话「加载中」这个状态
  // 永远不会出现在屏幕上，也就永远没人会去检查它好不好看。
  var FAKE_DELAY = 700;

  // 最近 7 天的假记录，从旧到新，最后一条是「今天」。
  // 这里只写数值和文字，日期由 buildRecords() 按今天倒推生成，所以永远看起来是「最近 7 天」。
  var FAKE_DAYS = [
    {
      exerciseType: '慢跑', exerciseMinutes: 30,
      weightKg: 66.2, waterMl: 1600,
      meals: ['鸡蛋 + 牛奶', '公司食堂', '番茄鸡蛋面'],
      tags: ['标准', '标准', '标准']
    },
    {
      exerciseType: '散步', exerciseMinutes: 45,
      weightKg: 66.0, waterMl: 1800,
      meals: ['豆浆 + 包子', '轻食沙拉', '水煮菜 + 鸡胸'],
      tags: ['标准', '清爽', '清爽']
    },
    {
      exerciseType: '力量训练', exerciseMinutes: 25,
      weightKg: 65.8, waterMl: 2000,
      meals: ['燕麦 + 香蕉', '米饭 + 炒青菜', '火锅'],
      tags: ['清爽', '标准', '丰盛']
    },
    {
      // 故意留一天「没运动、只记了午餐」，用来展示「部分填写」也能有一行记录
      exerciseType: '', exerciseMinutes: 0,
      weightKg: 65.9, waterMl: 1200,
      meals: ['', '面包 + 咖啡', ''],
      tags: ['', '标准', '']
    },
    {
      exerciseType: '跳绳', exerciseMinutes: 15,
      weightKg: 65.6, waterMl: 2200,
      meals: ['鸡蛋饼', '公司食堂', '牛奶 + 水果'],
      tags: ['标准', '标准', '清爽']
    },
    {
      exerciseType: '瑜伽', exerciseMinutes: 40,
      weightKg: 65.4, waterMl: 1900,
      meals: ['酸奶 + 坚果', '轻食沙拉', '番茄牛腩面'],
      tags: ['清爽', '清爽', '丰盛']
    },
    {
      exerciseType: '骑行', exerciseMinutes: 35,
      weightKg: 65.2, waterMl: 1500,
      meals: ['鸡蛋 + 牛奶', '轻食沙拉', '清炒时蔬'],
      tags: ['标准', '清爽', '清爽']
    }
  ];

  /* ---------- 日期工具 ---------- */

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // 本地时区日期 → 'YYYY-MM-DD'。
  // 注意：这里用 new Date(年, 月, 日) 的写法、再手动拼字符串，
  // 绝不把日期转成 UTC 时间戳 —— 一转就可能把「今天」算成「昨天」（时区纪律，TECH_DESIGN 2.2）。
  function toDateString(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- 组装假记录 ---------- */

  function buildRecords() {
    var now = new Date();

    return FAKE_DAYS.map(function (day, i) {
      // 数组最后一条 = 今天，往前依次是昨天、前天……
      var daysAgo = FAKE_DAYS.length - 1 - i;
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);

      return {
        date: toDateString(d),
        exerciseType: day.exerciseType,
        exerciseMinutes: day.exerciseMinutes,
        // 卡路里不由假数据手填，而是调用真实的换算表算出来（calories.js），
        // 复用同一份换算表，避免以后改了表这里对不上
        exerciseCalories: window.dhlCalories.estimate(day.exerciseType, day.exerciseMinutes),
        mealBreakfastText: day.meals[0],
        mealBreakfastTag: day.tags[0],
        mealLunchText: day.meals[1],
        mealLunchTag: day.tags[1],
        mealDinnerText: day.meals[2],
        mealDinnerTag: day.tags[2],
        weightKg: day.weightKg,
        waterMl: day.waterMl
      };
    });
  }

  /* ---------- 状态读取与取数 ---------- */

  // 从地址栏读 ?state=xxx；没写就是默认的 'data'
  function getState() {
    var matched = /[?&]state=([a-zA-Z]+)/.exec(window.location.search);
    return matched ? matched[1].toLowerCase() : 'data';
  }

  /**
   * 假装去取「最近几天的记录」。
   * 第 3 周接真接口时，只需把 setTimeout 那段换成 fetch(...)，
   * 保持「成功 resolve({ records: [...] })、失败 reject(错误)」的约定不变。
   * @param {string} state 调试状态：'error' 失败 / 'empty' 空数据 / 其他 正常返回
   * @returns {Promise<{records: Array}>}
   */
  function fetchPreview(state) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (state === 'error') {
          reject(new Error('假数据源故意报的错（?state=error）'));
          return;
        }
        if (state === 'empty') {
          resolve({ records: [] });
          return;
        }
        resolve({ records: buildRecords() });
      }, FAKE_DELAY);
    });
  }

  // 暴露给 landing.js
  window.dhlMock = {
    fetchPreview: fetchPreview,
    getState: getState,
    FAKE_DELAY: FAKE_DELAY
  };
})();
