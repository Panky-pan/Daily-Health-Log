/* ============================================
   state.js —— 列表四态的调试入口 + 模拟取数（Day 13）
   ------------------------------------------------------------
   历史记录页的筛选列表要展示「加载中 / 有结果 / 没有结果 / 请求失败」
   四种状态。本地数据是瞬间返回的，「加载中」和「请求失败」永远不会
   自然出现，所以这里向 mock.js 学习两条硬约定：

   1. 取数永远返回 Promise（成功 resolve / 失败 reject），
      第 3 周接真接口时只把本文件的 setTimeout 换成 fetch，调用方不动；
   2. 四种状态用地址栏调试（沿用 Day 8 口径），不往页面加调试按钮：
        history.html?state=loading   停在加载中（Promise 永不落定）
        history.html?state=empty     强制返回空结果（不管本地有没有数据）
        history.html?state=error     强制取数失败
        history.html                 正常（默认）
   ============================================ */

(function () {
  'use strict';

  // 假装网络花了 700 毫秒（和 mock.js 同款理由：不留延迟就没人检查加载态）
  var FAKE_DELAY = 700;

  // 从地址栏读 ?state=xxx；没写就是默认的 'data'
  function getState() {
    var matched = /[?&]state=([a-zA-Z]+)/.exec(window.location.search);
    return matched ? matched[1].toLowerCase() : 'data';
  }

  /**
   * 假装异步去取一份列表数据。
   * @param {Function} producer 同步取数函数 —— 正常路径由调用方传入
   *   （比如「扫 localStorage 里带某标签的记录」），本文件不关心数据长什么样。
   * @returns {Promise<{items: Array}>} 成功 resolve({items}) / 失败 reject(Error)
   */
  function fetchList(producer) {
    var state = getState();
    return new Promise(function (resolve, reject) {
      // ?state=loading：什么都不做，Promise 永远停在不落定的状态，
      // 页面就停在「加载中」——这是检查加载态样式的专用入口
      if (state === 'loading') return;

      setTimeout(function () {
        if (state === 'error') {
          reject(new Error('调试态 ?state=error 故意报的错'));
          return;
        }
        if (state === 'empty') {
          resolve({ items: [] }); // 调试空态：无视真实数据，强制给空
          return;
        }
        resolve({ items: producer() });
      }, FAKE_DELAY);
    });
  }

  // 暴露给 history.js 使用
  window.dhlState = {
    getState: getState,
    fetchList: fetchList,
    FAKE_DELAY: FAKE_DELAY
  };
})();
