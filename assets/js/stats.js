/* ============================================
   stats.js —— 统计计算（纯函数，不碰 DOM，不碰 localStorage）
   三个页面共用；二期迁移时这套函数原样复用（TECH_DESIGN 2.3）。
   统计口径按 PRD F3 死磕：
   - 当前 streak：今天已打卡 → 从今天往前数；今天没打卡 → 从昨天往前数
     （不因“今天还没打”清零，今天打卡后自动 +1）
   - 历史最长：全部记录中出现过的最大连续天数
   ============================================ */

(function () {
  'use strict';

  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  // 'YYYY-MM-DD' → 本地零点的 Date（不碰 UTC，避免 GMT+8 错位）
  function parseDate(str) {
    var p = String(str).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 日期字符串加减 n 天，返回 'YYYY-MM-DD'
  function addDays(dateStr, n) {
    var d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  // b - a 相差的天数（同为 YYYY-MM-DD）
  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / MS_PER_DAY);
  }

  /**
   * 当前连续打卡天数。
   * @param {object} checkins dhl:checkins 整个对象（date 为 key）
   * @param {string} today    今天的 'YYYY-MM-DD'
   */
  function currentStreak(checkins, today) {
    if (!checkins) return 0;
    // 今天没打卡时从昨天起数（PRD F3 口径）
    var cur = checkins[today] ? today : addDays(today, -1);
    var count = 0;
    while (checkins[cur]) {
      count++;
      cur = addDays(cur, -1);
    }
    return count;
  }

  /**
   * 历史最长连续打卡天数。
   */
  function longestStreak(checkins) {
    if (!checkins) return 0;
    var dates = Object.keys(checkins).sort();
    var best = 0;
    var run = 0;
    var prev = null;
    dates.forEach(function (d) {
      if (prev !== null && diffDays(prev, d) === 1) {
        run++;
      } else {
        run = 1;
      }
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }

  /**
   * 坚持率（PRD F3 口径，死磕原文）：
   * 分母 = startDate 起“至昨天”的天数（当天未结束不计入，避免今天还没打卡就被扣坚持率）；
   * 分子 = 这段时间里实际打卡的天数。
   * 返回 { days: 分母, checked: 分子, rate: 百分比整数或 null }；
   * rate 为 null 表示刚开始用（分母为 0），页面显示 “—”。
   */
  function adherence(checkins, startDate, today) {
    if (!startDate || !today) return { days: 0, checked: 0, rate: null };
    var denominator = diffDays(startDate, today); // startDate 至今天，不含今天 = 至昨天
    if (denominator <= 0) return { days: 0, checked: 0, rate: null };
    var yesterday = addDays(today, -1);
    var checked = 0;
    Object.keys(checkins || {}).forEach(function (d) {
      if (d >= startDate && d <= yesterday) checked++;
    });
    return {
      days: denominator,
      checked: checked,
      rate: Math.round((checked / denominator) * 100)
    };
  }

  /**
   * 每周运动时长汇总（PRD F4：近 4~8 周柱状图用）。
   * 周按「周一 ~ 周日」划分，返回从旧到新共 weeks 周：
   * [{ label: '9/15~9/21', minutes: 合计分钟 }, ...]（含当前周）
   */
  function weeklyExercise(checkins, today, weeks) {
    weeks = weeks || 8;
    var weekdayOffset = (parseDate(today).getDay() + 6) % 7; // 周一=0
    var thisMonday = addDays(today, -weekdayOffset);
    var result = [];
    for (var i = weeks - 1; i >= 0; i--) {
      var start = addDays(thisMonday, -7 * i);
      var end = addDays(start, 6);
      var sum = 0;
      Object.keys(checkins || {}).forEach(function (ds) {
        if (ds >= start && ds <= end) {
          var m = Number(checkins[ds].exerciseMinutes);
          if (isFinite(m) && m > 0) sum += m;
        }
      });
      result.push({
        label: shortDate(start) + '~' + shortDate(end),
        minutes: sum
      });
    }
    return result;
  }

  // '2026-09-15' → '9/15'（图轴短标签用）
  function shortDate(dateStr) {
    var p = dateStr.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }

  window.dhlStats = {
    addDays: addDays,
    diffDays: diffDays,
    formatDate: formatDate,
    currentStreak: currentStreak,
    longestStreak: longestStreak,
    adherence: adherence,
    weeklyExercise: weeklyExercise
  };
})();
