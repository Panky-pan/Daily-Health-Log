/* ============================================
   check.js —— 检查台页（开发自测用，2026-10-06 新增）
   ------------------------------------------------------------
   干什么：页面一打开就把三件事摊开给你看
     ① 服务健康状态   GET  /api/health
     ② 数据库真实记录 GET  /api/checkins（checkins 表，前 30 条）
     ③ 写入测试       PUT  /api/checkins/{date}（固定样例内容）

   为什么自己写 fetch 而不复用 api-source.js 的 load()：
     load() 做的事是「取数 → 塞进 storage 的云端覆盖层 → 让页面照旧从 dhlStorage 读」，
   那是给业务页用的。检查台要的是「原样把接口返回摊开」，不经过 storage 这一层，
   反而更能看清接口本身返回了什么。写接口则直接复用 dhlApi.saveCheckin（同一套请求逻辑）。

   这个页面只做「看」和「写测试」，不碰 localStorage，不改任何业务数据。
   ============================================ */

(function () {
  'use strict';

  var BASE = window.dhlApi.API_BASE;
  var LIST_LIMIT = 30;   // 表格只摊最近 30 条，够看又不刷屏

  // 写入测试用的固定样例内容（字段与契约 3.2 一致，全部合法值）
  var SAMPLE = {
    exerciseType: '慢跑',
    exerciseMinutes: 30,
    exerciseCalories: 300,
    mealBreakfastText: '',
    mealBreakfastTag: '',
    mealLunchText: '检查台写入测试',
    mealLunchTag: '普通',
    mealDinnerText: '',
    mealDinnerTag: '',
    weightKg: 64.5,
    waterMl: 1500
  };

  var TAG_ICON = { '健康': '🥗', '普通': '🍚', '放纵': '🍔' };

  var $ = function (id) { return document.getElementById(id); };

  /** 本地今天的日期字符串 YYYY-MM-DD（不用 toISOString，那是 UTC，会差一天）。 */
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  /** 空值一律显示成破折号，别在页面上印出 undefined / null（契约 2.6）。 */
  function val(x, suffix) {
    if (x === '' || x === undefined || x === null) return '—';
    return suffix ? x + suffix : String(x);
  }

  /** 体重 / 饮水这类「数字 + 单位」的列：空值不带单位，直接显示破折号。 */
  function valUnit(x, unit) {
    if (x === '' || x === undefined || x === null) return '—';
    return x + unit;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mealText(text, tag) {
    if (!text && !tag) return '—';
    var icon = tag ? (TAG_ICON[tag] || '') : '';
    var label = tag ? (icon + ' ' + tag) : '';
    return escapeHtml([text, label].filter(Boolean).join(' · '));
  }

  // ---------------------------------------------------------------------
  // 通用请求：失败时把接口的中文 message 原样带出来，不加工
  // ---------------------------------------------------------------------
  function getJson(path) {
    return fetch(BASE + path).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || !body || body.ok !== true) {
          throw new Error((body && body.error && body.error.message) || ('HTTP ' + res.status));
        }
        return body.data;
      });
    });
  }

  // ---------------------------------------------------------------------
  // ① 健康状态
  // ---------------------------------------------------------------------
  function renderHealth(state, text, meta) {
    $('health-dot').className = 'check-dot check-dot-' + state;
    $('health-text').textContent = text;
    $('health-meta').textContent = meta || '';
    $('health-error').hidden = true;
  }

  function loadHealth() {
    $('btn-health').disabled = true;
    renderHealth('load', '正在问接口…');

    // A1 的响应形状是契约里唯一的例外：直接 {ok,service,time}，没有 data 包裹
    fetch(BASE + '/api/health')
      .then(function (res) { return res.json(); })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error((body && body.error && body.error.message) || '服务没回应');
        renderHealth('ok', '服务正常，接口活着', '服务名 ' + body.service + ' · 服务器时间 ' + body.time);
      })
      .catch(function (e) {
        renderHealth('bad', '连不上服务', '');
        $('health-error').hidden = false;
        $('health-error').textContent = '连不上接口：' + ((e && e.message) || '网络不通') + '（页面仍可打开，只是取不到数据）';
      })
      .then(function () { $('btn-health').disabled = false; });
  }

  // ---------------------------------------------------------------------
  // ② 数据库真实记录
  // ---------------------------------------------------------------------
  var lastItems = [];   // 最近一次取到的记录，写入测试判断「那天有没有记录」时用

  function renderRows(items) {
    var rows = items.map(function (it) {
      var sport = it.exerciseType
        ? escapeHtml(it.exerciseType) + ' ' + val(it.exerciseMinutes, ' 分钟')
        : '—';
      return '<tr>' +
        '<td>' + escapeHtml(it.date) + '</td>' +
        '<td>' + sport + '</td>' +
        '<td>' + mealText(it.mealLunchText, it.mealLunchTag) + '</td>' +
        '<td>' + valUnit(it.weightKg, ' kg') + '</td>' +
        '<td>' + valUnit(it.waterMl, ' ml') + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="table-scroll"><table class="data-table">' +
      '<thead><tr><th>日期</th><th>运动</th><th>午餐</th><th>体重</th><th>饮水</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function loadCheckins() {
    $('btn-reload').disabled = true;
    $('checkins-meta').textContent = '正在取数据…';
    $('checkins-box').innerHTML = '';

    getJson('/api/checkins?limit=' + LIST_LIMIT)
      .then(function (data) {
        var items = data.items || [];
        lastItems = items;
        renderUpdated(items);   // 数据到手才算「最后更新」，所以放在这

        if (!items.length) {
          // 空状态：最容易漏的一档，必须给一句话而不是空白
          $('checkins-meta').textContent = '一条记录也没有。';
          $('checkins-box').innerHTML =
            '<p class="check-empty">库里还是空的，<a href="checkin.html">去打卡页记一笔</a>，回来刷新就能看到。</p>';
          return;
        }

        $('checkins-meta').textContent = '共 ' + data.total + ' 条，下面摊开最近 ' + items.length + ' 条（都是数据库里的真实数据，不是浏览器本地存的）。';
        $('checkins-box').innerHTML = renderRows(items);
      })
      .catch(function (e) {
        $('checkins-meta').textContent = '没取到数据。';
        // 取数失败时别还写「库里最新记录」，那会让人以为库里真是空的
        $('last-updated').textContent =
          '最后更新：本次检查 ' + stampNow() + ' · 取数据失败，这一行只说明检查时间';
        $('checkins-box').innerHTML =
          '<p class="check-empty check-empty-bad">取数据失败：' + escapeHtml((e && e.message) || '未知错误') + '</p>';
      })
      .then(function () { $('btn-reload').disabled = false; });
  }

  // ---------------------------------------------------------------------
  // ③ 写入测试
  // ---------------------------------------------------------------------
  function renderPreview() {
    $('write-preview').textContent =
      '样例内容：慢跑 ' + SAMPLE.exerciseMinutes + ' 分钟（' + SAMPLE.exerciseCalories + ' 大卡）· ' +
      '午餐「' + SAMPLE.mealLunchText + '」🍚 普通 · 体重 ' + SAMPLE.weightKg + ' kg · 饮水 ' + SAMPLE.waterMl + ' ml';
  }

  function showWriteError(msg) {
    $('write-error').hidden = false;
    $('write-error').textContent = msg;
    $('write-status').hidden = true;
  }

  function doWrite() {
    var date = $('write-date').value;
    if (!date) { showWriteError('先选一个日期再写。'); return; }

    // 覆盖前先看一眼那天有没有记录：有就问一句，别闷头把真实记录替换掉
    var existing = lastItems.filter(function (it) { return it.date === date; })[0];
    if (existing) {
      var ok = window.confirm(
        date + ' 已经有记录了：\n' +
        '运动 ' + val(existing.exerciseType) + ' / 午餐 ' + val(existing.mealLunchText) + ' / 体重 ' + val(existing.weightKg) + '\n\n' +
        '写入是「覆盖保存」，点确定会用样例内容替换它。\n（不想覆盖就取消，把日期换成没记录的一天）'
      );
      if (!ok) return;
    }

    $('btn-write').disabled = true;
    $('btn-write').textContent = '正在写入…';
    $('write-error').hidden = true;
    $('write-status').hidden = true;

    // 复用页面已有的写接口逻辑（api-source.js 的 saveCheckin，成功失败都收敛成 {ok,...}）
    window.dhlApi.saveCheckin(date, SAMPLE)
      .then(function (r) {
        if (!r.ok) { showWriteError('没写上：' + r.message); return; }
        $('write-status').hidden = false;
        $('write-status').textContent = r.isNew
          ? '写进去了：' + date + ' 是一条新记录。'
          : '覆盖成功：' + date + ' 原有的记录已换成样例内容。';
        loadCheckins();   // 立刻回读一次，让表格自己证明它真的进库了
      })
      .catch(function (e) {
        showWriteError('没写上：' + ((e && e.message) || '未知错误'));
      })
      .then(function () {
        $('btn-write').disabled = false;
        $('btn-write').textContent = '写入测试';
      });
  }

  // ---------------------------------------------------------------------
  // 最后更新时间（余力加练，2026-10-06）
  // ---------------------------------------------------------------------
  // 一行显示两件事：这次检查发生在几点（本地时钟）、库里最新一条记录是哪天。
  // 「重新检查」「刷新数据」以及写入测试成功后都会自动重算，
  // 所以它永远反映「眼前这份数据有多新」，而不是页面上写死的一个日期。
  function stampNow() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return today() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderUpdated(items) {
    // 日期是 YYYY-MM-DD 这种定长格式，字符串比大小就等于比日期，
    // 所以直接取最大那个，不依赖接口返回的顺序（带 limit 时接口是升序返回的）。
    var latest = '';
    (items || []).forEach(function (it) {
      if (it && it.date && it.date > latest) latest = it.date;
    });
    $('last-updated').textContent =
      '最后更新：本次检查 ' + stampNow() + ' · 数据取自云端 · 库里最新记录 ' + (latest || '暂无');
  }

  // ---------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------
  $('write-date').value = today();
  $('write-date').max = today();     // 不给写未来日期，和打卡页一个口径
  renderPreview();
  loadHealth();
  loadCheckins();

  $('btn-health').addEventListener('click', loadHealth);
  $('btn-reload').addEventListener('click', loadCheckins);
  $('btn-write').addEventListener('click', doWrite);
  $('write-date').addEventListener('change', function () {
    var picked = this.value;
    var hit = lastItems.filter(function (it) { return it.date === picked; })[0];
    $('write-date-hint').textContent = hit
      ? '注意：这天已经有记录了，写入会覆盖它。'
      : '';
  });
})();
