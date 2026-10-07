/* ============================================
   check.js —— 检查台页（开发自测用，2026-10-06 新增）
   ------------------------------------------------------------
   干什么：页面一打开就把五件事摊开给你看
     ① 服务健康状态   GET    /api/health
     ② 数据库真实记录 GET    /api/checkins（checkins 表，前 30 条）
     ③ 写入测试       PUT    /api/checkins/{date}（整条覆盖，固定样例内容）
     ④ 局部修改测试   PATCH  /api/checkins/{date}（只改固定样例里的那几个字段）
     ⑤ 删除测试       DELETE /api/checkins/{date}（不可恢复，所以有二次确认）

   ④⑤ 是 2026-10-07 加的，和 ③ 刚好凑成一组对照：
     ③ 证明「写得进去」；④ 证明「只动想动的那几列，其余原样保留」；
     ⑤ 证明「删得掉；删不存在的会拿到中文提示而不是报错页」。

   为什么自己写 fetch 而不复用 api-source.js 的 load()：
     load() 做的事是「取数 → 塞进 storage 的云端覆盖层 → 让页面照旧从 dhlStorage 读」，
   那是给业务页用的。检查台要的是「原样把接口返回摊开」，不经过 storage 这一层，
   反而更能看清接口本身返回了什么。三个写类接口则直接复用 dhlApi 里的现成方法
   （saveCheckin / patchCheckin / deleteCheckin），页面不自己拼请求。

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

  // ④ 局部修改（PATCH）用的固定样例：每条只带一两个字段，值都是契约 4.2 允许的合法值。
  //    故意做了「只改一格」和「一次改两格」两类，好对照接口到底写了哪些列。
  var PATCH_PRESETS = [
    { key: 'weight', label: '只改体重 → 66 kg', fields: { weightKg: 66 } },
    { key: 'water', label: '只改饮水 → 2000 ml', fields: { waterMl: 2000 } },
    { key: 'lunch', label: '只改午餐文字 → 检查台 PATCH 测试', fields: { mealLunchText: '检查台 PATCH 测试' } },
    { key: 'two', label: '一次改两项 → 体重 65.5 kg + 饮水 1800 ml', fields: { weightKg: 65.5, waterMl: 1800 } }
  ];

  // 字段的中文名 + 单位（只列 PATCH 样例会用到的几个，够把请求体说成人话）
  var FIELD_LABEL = {
    weightKg: { name: '体重', unit: ' kg' },
    waterMl: { name: '饮水', unit: ' ml' },
    exerciseMinutes: { name: '运动时长', unit: ' 分钟' },
    mealLunchText: { name: '午餐文字', unit: '' }
  };

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

  /**
   * 把一个 fields 对象说成人话，如「体重 66 kg、饮水 1800 ml」。
   * @param {Object} fields 要描述的字段集合（决定说哪几项、按什么顺序说）
   * @param {Object} source 从哪儿取值（改前传当天记录，改后传 fields 自己）
   */
  function describeFields(fields, source) {
    return Object.keys(fields).map(function (k) {
      var meta = FIELD_LABEL[k] || { name: k, unit: '' };
      var v = source[k];
      var shown = (v === '' || v === undefined || v === null) ? '空' : v + meta.unit;
      return meta.name + ' ' + shown;
    }).join('、');
  }

  /** 按当前选择的样例，取回它对应的预设对象。 */
  function currentPreset() {
    var key = $('patch-preset').value;
    var hit = PATCH_PRESETS.filter(function (p) { return p.key === key; })[0];
    return hit || PATCH_PRESETS[0];
  }

  /** 在 lastItems 里找某天的记录；没有就是 undefined（三张测试卡共用这个口径）。 */
  function findRow(date) {
    return lastItems.filter(function (it) { return it.date === date; })[0];
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
        refreshDateHints();     // 数据变了，「这天有没有记录」的提示也跟着重算

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
  // ④ 局部修改测试（PATCH，2026-10-07 新增）
  // ---------------------------------------------------------------------
  function renderPatchPreview() {
    var preset = currentPreset();
    var names = Object.keys(preset.fields);
    $('patch-preview').textContent =
      '将发送：PATCH /api/checkins/' + ($('patch-date').value || '（先选日期）') +
      ' · 请求体 ' + JSON.stringify(preset.fields) +
      ' · 只有这 ' + names.length + ' 个字段，其余列数据库里原样不动。';
  }

  function showPatchError(msg) {
    $('patch-error').hidden = false;
    $('patch-error').textContent = msg;
    $('patch-status').hidden = true;
  }

  function doPatch() {
    var date = $('patch-date').value;
    if (!date) { showPatchError('先选一个日期再改。'); return; }

    var preset = currentPreset();

    // 本地先挡一道：那天没记录就不发请求了，直接把原因说清楚（省一次 404 往返）
    var row = findRow(date);
    if (!row) {
      showPatchError(date + ' 这天还没有记录，改不了。PATCH 只改已有的记录——先去上面「写入测试」给这天写一条，或者换一天。');
      return;
    }

    // 二次确认：把「改哪几项、从什么变成什么」都念出来，别让人糊里糊涂就改了
    var ok = window.confirm(
      '确认修改 ' + date + ' 的记录吗？\n\n' +
      '改前：' + describeFields(preset.fields, row) + '\n' +
      '改后：' + describeFields(preset.fields, preset.fields) + '\n\n' +
      '只有这几列会被改动，这天记录的其他内容保持不变。'
    );
    if (!ok) return;

    $('btn-patch').disabled = true;
    $('btn-patch').textContent = '正在修改…';
    $('patch-error').hidden = true;
    $('patch-status').hidden = true;

    // 复用 api-source.js 的 patchCheckin（成功失败都收敛成 {ok,...}，不会 reject）
    window.dhlApi.patchCheckin(date, preset.fields)
      .then(function (r) {
        if (!r.ok) { showPatchError('没改成：' + r.message); return; }
        $('patch-status').hidden = false;
        $('patch-status').textContent =
          '改好了：' + date + ' 的 ' + describeFields(preset.fields, preset.fields) +
          '（这次只发了 ' + Object.keys(preset.fields).length + ' 个字段，其他列没动）。';
        loadCheckins();   // 立刻回读，让表格自己证明改动真的落库了
      })
      .catch(function (e) {
        showPatchError('没改成：' + ((e && e.message) || '未知错误'));
      })
      .then(function () {
        $('btn-patch').disabled = false;
        $('btn-patch').textContent = '局部修改测试';
      });
  }

  // ---------------------------------------------------------------------
  // ⑤ 删除测试（DELETE，2026-10-07 新增）
  // ---------------------------------------------------------------------
  function showDeleteError(msg) {
    $('delete-error').hidden = false;
    $('delete-error').textContent = msg;
    $('delete-status').hidden = true;
  }

  function doDelete() {
    var date = $('delete-date').value;
    if (!date) { showDeleteError('先选一个日期再删。'); return; }

    // 本地先挡一道：本来就没记录的日子不用发请求
    var row = findRow(date);
    if (!row) {
      showDeleteError(date + ' 这天本来就没有记录，没什么可删的。换一天试试。');
      return;
    }

    // 二次确认（AGENTS.md 第八条：页面上的删除操作必须二次确认）。
    // 这里把即将被删掉的内容原样念出来，并明说不可恢复——不给「撤销」留幻想。
    var ok = window.confirm(
      '要删掉 ' + date + ' 的这条记录吗？\n\n' +
      date + '：运动 ' + val(row.exerciseType) +
      ' / 午餐 ' + val(row.mealLunchText) +
      ' / 体重 ' + val(row.weightKg) +
      ' / 饮水 ' + val(row.waterMl) + '\n\n' +
      '删了就回不来了，页面上没有撤销，只能重新打卡再记一遍。'
    );
    if (!ok) return;

    $('btn-delete').disabled = true;
    $('btn-delete').textContent = '正在删除…';
    $('delete-error').hidden = true;
    $('delete-status').hidden = true;

    // 复用 api-source.js 的 deleteCheckin（同样收敛成 {ok,...}
    window.dhlApi.deleteCheckin(date)
      .then(function (r) {
        if (!r.ok) { showDeleteError('没删掉：' + r.message); return; }
        $('delete-status').hidden = false;
        $('delete-status').textContent = '删掉了：' + r.date + ' 这条记录已经不在库里了。';
        loadCheckins();   // 立刻回读，表格里那一行应该消失
      })
      .catch(function (e) {
        showDeleteError('没删掉：' + ((e && e.message) || '未知错误'));
      })
      .then(function () {
        $('btn-delete').disabled = false;
        $('btn-delete').textContent = '删除测试';
      });
  }

  // ---------------------------------------------------------------------
  // 三张卡共用的「这天有没有记录」提示
  // ---------------------------------------------------------------------
  // 数据刷新后（loadCheckins 成功）和用户换日期时都重算一次。
  // 提示按每张卡的后果分别写，不写一句通用的废话。
  function refreshDateHints() {
    var w = $('write-date').value;
    $('write-date-hint').textContent = findRow(w) ? '注意：这天已经有记录了，写入会覆盖它。' : '';

    var p = $('patch-date').value;
    $('patch-date-hint').textContent = findRow(p)
      ? '这天有记录，可以改。'
      : '这天没有记录——PATCH 只改已有的记录，点了会收到 404。';

    var d = $('delete-date').value;
    $('delete-date-hint').textContent = findRow(d)
      ? '这天有记录，点了就会把这整条删掉。'
      : '这天没有记录，没什么可删的。';
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

  // ④⑤ 的日期默认也是今天，同样不给选未来（那天不可能有记录）
  $('patch-date').value = today();
  $('patch-date').max = today();
  $('delete-date').value = today();
  $('delete-date').max = today();

  // ④ 的样例下拉由 JS 生成，PATCH_PRESETS 是唯一来源（以后加样例只改那一个数组）
  $('patch-preset').innerHTML = PATCH_PRESETS.map(function (p) {
    return '<option value="' + escapeHtml(p.key) + '">' + escapeHtml(p.label) + '</option>';
  }).join('');
  renderPatchPreview();

  loadHealth();
  loadCheckins();

  $('btn-health').addEventListener('click', loadHealth);
  $('btn-reload').addEventListener('click', loadCheckins);
  $('btn-write').addEventListener('click', doWrite);
  $('btn-patch').addEventListener('click', doPatch);
  $('btn-delete').addEventListener('click', doDelete);

  // 三张卡的日期提示统一走 refreshDateHints，不再各写一份判断
  $('write-date').addEventListener('change', refreshDateHints);
  $('delete-date').addEventListener('change', refreshDateHints);
  $('patch-date').addEventListener('change', function () {
    refreshDateHints();
    renderPatchPreview();     // 预览行里带着日期，换日期要跟着变
  });
  $('patch-preset').addEventListener('change', renderPatchPreview);
})();
