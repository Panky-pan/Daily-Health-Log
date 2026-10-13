/* ============================================
   calories.js —— 运动卡路里内置换算表（PRD 6.3）
   换算表写死在这里，不做配置；要改数值只动这一个文件。
   用户永远不会手填卡路里，一律由此函数估算。
   ============================================ */

(function () {
  'use strict';

  // 每分钟估算大卡数（PRD 6.3，实现时可微调）
  var CALORIES_PER_MINUTE = {
    '散步': 4,
    '慢跑': 10,
    '跳绳': 12,
    '骑行': 8,
    '力量训练': 6,
    '瑜伽': 3
  };

  /**
   * 估算运动卡路里。
   * @param {string} type  运动类型（须与换算表的 key 完全一致）
   * @param {number} minutes 运动分钟数
   * @returns {number} 估算大卡数（四舍五入取整）；类型未知或时长无效时返回 0
   */
  function estimate(type, minutes) {
    var rate = CALORIES_PER_MINUTE[type];
    if (!rate || typeof minutes !== 'number' || !isFinite(minutes) || minutes <= 0) {
      return 0;
    }
    return Math.round(rate * minutes);
  }

  // 暴露给其他文件
  window.dhlCalories = {
    estimate: estimate,
    table: CALORIES_PER_MINUTE
  };
})();
