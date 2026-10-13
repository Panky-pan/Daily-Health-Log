/* ============================================
   Day 11 · 开屏页主按钮状态机
   空闲 → (点击) → 处理中 → (成功) 跳转 index.html
                       ↘ (失败) 显示提示，恢复可点
   加载是 setTimeout 模拟的（数据还没接后端，不依赖后端）
   ============================================ */
(function () {
  'use strict';

  var enterBtn = document.getElementById('enter-btn');
  var errorTip = document.getElementById('enter-error');

  var IDLE_TEXT = '开启我的健康记录';
  var LOADING_TEXT = '正在打开…';
  var LOAD_MS = 800;          // 模拟加载时长（毫秒）
  var BUBBLE_COUNT = 8;       // 每次点击生成的泡泡数

  // 尊重系统减动效设置：开了减动效就不放泡泡
  var prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- 调试入口：?state=error 强制走失败分支（沿用 Day 8 约定） ---- */
  function shouldFail() {
    return new URLSearchParams(location.search).get('state') === 'error';
  }

  /* ---- 泡泡戳破：在按钮附近随机位置生成，动画结束自动移除 ----
     坐标用 getBoundingClientRect（视口坐标），泡泡用 position:fixed，
     两套坐标系一致，页面滚动也不跑偏 */
  function popBubbles() {
    var rect = enterBtn.getBoundingClientRect();
    for (var i = 0; i < BUBBLE_COUNT; i++) {
      var bubble = document.createElement('span');
      bubble.className = 'bubble';
      var size = 8 + Math.random() * 14;                       // 直径 8~22px
      bubble.style.width = size + 'px';
      bubble.style.height = size + 'px';
      // 以按钮中心为原点，横向散开，纵向稍微高过按钮
      bubble.style.left =
        (rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width) + 'px';
      bubble.style.top =
        (rect.top + rect.height / 2 + (Math.random() - 0.6) * 24) + 'px';
      bubble.style.animationDuration = (0.7 + Math.random() * 0.5) + 's';
      document.body.appendChild(bubble);
      bubble.addEventListener('animationend', function () {
        this.remove();   // 动画放完自动清理，不留垃圾节点
      });
    }
  }

  /* ---- 失败恢复：按钮回到空闲，亮出错误提示 ---- */
  function backToIdleWithError() {
    enterBtn.disabled = false;
    enterBtn.textContent = IDLE_TEXT;
    enterBtn.classList.remove('btn-loading');
    document.body.classList.remove('is-entering');
    errorTip.hidden = false;
  }

  /* ---- 主流程：一次点击走完整状态机 ---- */
  enterBtn.addEventListener('click', function () {
    // 处理中不允许重复触发（disabled 已挡住鼠标，这里是逻辑双保险）
    if (enterBtn.disabled) return;

    enterBtn.disabled = true;                 // 锁死按钮：连点无效
    enterBtn.textContent = LOADING_TEXT;      // 文字变化 = 最直接的"收到"反馈
    enterBtn.classList.add('btn-loading');
    document.body.classList.add('is-entering'); // 触发小人上举动画
    errorTip.hidden = true;                   // 新一轮尝试前先收起旧提示

    if (!prefersReducedMotion) {
      popBubbles();
    }

    window.setTimeout(function () {
      if (shouldFail()) {
        backToIdleWithError();                // 失败：恢复按钮 + 显示提示
      } else {
        location.href = 'index.html';         // 成功：跳转进应用
      }
    }, LOAD_MS);
  });
})();
