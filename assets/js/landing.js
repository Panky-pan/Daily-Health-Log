/* ============================================
   landing.js —— 开屏页：把数据画成卡片和列表
   ------------------------------------------------------------
   本文件干三件事：
   1. 调度四种页面状态：loading 加载中 / data 有数据 / empty 空 / error 出错
      （同一个时刻只显示其中一个容器）
   2. 把「最新那天的记录」算成「今日概览」四张卡片的文字
   3. 把记录数组画成「最近 7 天」列表
   数据一律来自 mock.js 的 fetchPreview()（第 3 周换成真接口，本文件不用改）。

   渲染方式：用 document.createElement 逐个建元素，不拼 HTML 字符串。
   理由：将来数据来自服务器，拼字符串容易把数据里的文字当成代码执行；
   用 createElement + textContent，浏览器会自动把文字当纯文本处理，天然安全。
   ============================================ */

(function () {
  'use strict';

  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var MEAL_TEXT_KEYS = ['mealBreakfastText', 'mealLunchText', 'mealDinnerText'];

  /* ---------- 页面上的四个状态容器 ---------- */
  var boxLoading = document.getElementById('preview-loading');
  var boxData = document.getElementById('preview-data');
  var boxEmpty = document.getElementById('preview-empty');
  var boxError = document.getElementById('preview-error');
  var cardsBox = document.getElementById('preview-cards');
  var listBox = document.getElementById('preview-list');
  var retryBtn = document.getElementById('preview-retry');

  /* ---------- 状态切换：四个容器同一时刻只显示一个 ---------- */
  function showState(name) {
    boxLoading.hidden = name !== 'loading';
    boxData.hidden = name !== 'data';
    boxEmpty.hidden = name !== 'empty';
    boxError.hidden = name !== 'error';
  }

  /* ---------- 小工具 ---------- */

  // 建元素：el('p', 'preview-card-note', '文字')
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
  }

  // '2026-09-23' → '09-23'（只切字符串，不碰时区）
  function shortDate(date) {
    return typeof date === 'string' && date.length >= 10 ? date.slice(5) : '';
  }

  // '2026-09-23' → '周三'。手动拆年月日再交给 Date，避免被当成 UTC 解析（时区纪律）
  function weekday(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
    var parts = date.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return '周' + WEEKDAYS[d.getDay()];
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  // 数一数这天记了几餐（有文字就算记了）
  function countMeals(record) {
    var count = 0;
    MEAL_TEXT_KEYS.forEach(function (key) {
      if (record[key]) count += 1;
    });
    return count;
  }

  /* ---------- 二、把最新那天的记录算成四张卡片 ---------- */

  function exerciseCard(record) {
    var minutes = toNumber(record.exerciseMinutes);
    if (minutes <= 0) {
      return { label: '运动', value: '—', unit: '', note: '今天还没动，走两步也算数' };
    }
    return {
      label: '运动',
      value: String(minutes),
      unit: '分钟',
      note: record.exerciseType + ' · 约 ' + toNumber(record.exerciseCalories) + ' 大卡'
    };
  }

  function waterCard(record, prev) {
    var water = toNumber(record.waterMl);
    var note = '今天喝的水';
    if (prev) {
      var diff = water - toNumber(prev.waterMl);
      if (diff === 0) note = '和昨天一样多';
      else if (diff > 0) note = '比昨天多 ' + diff + ' ml';
      else note = '比昨天少 ' + (-diff) + ' ml';
    }
    return {
      label: '饮水',
      value: water > 0 ? String(water) : '—',
      unit: water > 0 ? 'ml' : '',
      note: note
    };
  }

  function weightCard(record, prev) {
    var weight = toNumber(record.weightKg);
    var note = '今天称的';
    if (prev && weight > 0) {
      var diff = Number((weight - toNumber(prev.weightKg)).toFixed(1));
      if (diff === 0) note = '和昨天持平';
      else if (diff < 0) note = '比昨天轻 ' + Math.abs(diff).toFixed(1) + ' kg';
      else note = '比昨天重 ' + diff.toFixed(1) + ' kg';
    }
    return {
      label: '体重',
      value: weight > 0 ? weight.toFixed(1) : '—',
      unit: weight > 0 ? 'kg' : '',
      note: note
    };
  }

  function mealCard(record) {
    var count = countMeals(record);
    // 小注优先显示午餐（一天里最有代表性的一餐），没有就退到标签
    var note = '今天还没记吃了什么';
    if (record.mealLunchText) note = '午餐：' + record.mealLunchText;
    else if (count > 0) note = '记了 ' + count + ' 餐';
    return {
      label: '饮食',
      value: count > 0 ? String(count) : '—',
      unit: count > 0 ? '餐' : '',
      note: note
    };
  }

  function renderCards(records) {
    var latest = records[records.length - 1];
    var prev = records.length > 1 ? records[records.length - 2] : null;

    var cards = [
      exerciseCard(latest),
      waterCard(latest, prev),
      weightCard(latest, prev),
      mealCard(latest)
    ];

    cardsBox.textContent = '';   // 先清空，重试时不会越画越多
    cards.forEach(function (card) {
      var box = el('div', 'preview-card');
      box.appendChild(el('p', 'preview-card-label', card.label));

      var value = el('p', 'preview-card-value', card.value);
      if (card.unit) value.appendChild(el('span', 'preview-card-unit', card.unit));
      box.appendChild(value);

      box.appendChild(el('p', 'preview-card-note', card.note));
      cardsBox.appendChild(box);
    });
  }

  /* ---------- 三、把记录数组画成列表 ---------- */

  function buildRow(record) {
    var row = el('li', 'record-row');

    // 左：日期 + 星期
    var dateBox = el('div', 'record-date');
    dateBox.appendChild(el('span', 'record-md', shortDate(record.date)));
    dateBox.appendChild(el('span', 'record-wd', weekday(record.date)));
    row.appendChild(dateBox);

    // 中：运动 + 一行小字（饮水 / 记了几餐）
    var body = el('div', 'record-body');
    var minutes = toNumber(record.exerciseMinutes);
    body.appendChild(el('span', 'record-exercise',
      minutes > 0 ? record.exerciseType + ' ' + minutes + ' 分钟' : '这天没运动'));

    var metaParts = [];
    var water = toNumber(record.waterMl);
    if (water > 0) metaParts.push('饮水 ' + water + ' ml');
    var mealCount = countMeals(record);
    if (mealCount > 0) metaParts.push('记了 ' + mealCount + ' 餐');
    body.appendChild(el('span', 'record-meta', metaParts.join(' · ') || '这天没记别的'));
    row.appendChild(body);

    // 右：体重
    var weight = toNumber(record.weightKg);
    row.appendChild(el('div', 'record-weight', weight > 0 ? weight.toFixed(1) + ' kg' : '—'));

    return row;
  }

  function renderList(records) {
    listBox.textContent = '';   // 先清空，重试时不会越画越多
    // 最新的排最上面
    records.slice().reverse().forEach(function (record) {
      listBox.appendChild(buildRow(record));
    });
  }

  /* ---------- 一、取数 + 四种状态调度 ---------- */

  function load() {
    showState('loading');   // 先亮骨架屏，等数据回来再换

    var state = window.dhlMock.getState();

    window.dhlMock.fetchPreview(state)
      .then(function (data) {
        var records = (data && data.records) || [];
        if (records.length === 0) {
          showState('empty');   // 取到了，但一条记录也没有
          return;
        }
        renderCards(records);
        renderList(records);
        showState('data');      // 有数据
      })
      .catch(function () {
        showState('error');     // 取数失败（Promise 的 reject 走这里）
      });
  }

  function init() {
    // mock.js 没加载上也要有个说法，不能让页面白屏
    if (!window.dhlMock) {
      showState('error');
      return;
    }

    // ?state=loading 时停在加载中，方便慢慢看骨架屏；其余情况走正常取数
    if (window.dhlMock.getState() === 'loading') {
      showState('loading');
      return;
    }

    load();
  }

  // 「重新加载」按钮：重新取一次数。
  // 注意：如果地址栏带着 ?state=error，这里会再失败一次 —— 那是预期的（它本来就是失败开关）。
  // 想看成功的样子，把地址栏的 ?state=error 删掉再刷新。
  retryBtn.addEventListener('click', function () {
    load();
  });

  init();
})();
