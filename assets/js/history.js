/* ============================================
   history.js —— 历史记录页逻辑（PRD F3 / E8）
   - 统计卡：当前连续 / 历史最长 / 坚持率（口径全在 stats.js）
   - 当月日历：打卡日绿色标记、今天描边、未来日期不可点（E8）
   - 上/下月切换（E8 跨月）
   - 点已打卡的日子 → 下方显示单日详情（A7）
   数据异常（E1/E2：没有任何记录）时显示引导文案，不报错不白屏。
   ============================================ */

(function () {
  'use strict';

  /* ---- 页面元素 ---- */
  var statStreak = document.getElementById('stat-streak');
  var statLongest = document.getElementById('stat-longest');
  var statRate = document.getElementById('stat-rate');
  var calTitle = document.getElementById('cal-title');
  var calGrid = document.getElementById('calendar-grid');
  var calHint = document.getElementById('cal-hint');
  var detailCard = document.getElementById('detail-card');
  var detailTitle = document.getElementById('detail-title');
  var detailBody = document.getElementById('detail-body');
  var prevBtn = document.getElementById('btn-prev-month');
  var nextBtn = document.getElementById('btn-next-month');

  // 当前查看的年月（state），默认今天所在月
  var view = { year: 0, month: 0 }; // month: 1~12
  var today = '';

  /* ---- 日历构建 ---- */

  function init() {
    var now = new Date();
    view.year = now.getFullYear();
    view.month = now.getMonth() + 1;
    today = window.dhlStats.formatDate(now); // YYYY-MM-DD 本地日期
    renderStats();
    renderCalendar();
  }

  // 统计卡：streak ×2 + 坚持率
  function renderStats() {
    var checkins = window.dhlStorage.getCheckins();
    var settings = window.dhlStorage.getSettings();

    statStreak.textContent = window.dhlStats.currentStreak(checkins, today);
    statLongest.textContent = window.dhlStats.longestStreak(checkins);

    // 坚持率：分母 = startDate 至昨天（PRD F3）；刚开始用显示 “—”
    var rate = window.dhlStats.adherence(checkins, settings && settings.startDate, today);
    statRate.textContent = rate.rate === null ? '—' : rate.rate + '%';
  }

  function renderCalendar() {
    calTitle.textContent = view.year + ' 年 ' + view.month + ' 月';
    calGrid.innerHTML = ''; // 清空重建

    var checkins = window.dhlStorage.getCheckins();
    var firstWeekday = (new Date(view.year, view.month - 1, 1).getDay() + 6) % 7; // 周一=0
    var daysInMonth = new Date(view.year, view.month, 0).getDate();

    // 第一行前面的空格
    for (var i = 0; i < firstWeekday; i++) {
      var blank = document.createElement('span');
      blank.className = 'cal-cell cal-blank';
      calGrid.appendChild(blank);
    }

    var hasAnyRecord = false;
    for (var day = 1; day <= daysInMonth; day++) {
      var m = String(view.month).padStart(2, '0');
      var d = String(day).padStart(2, '0');
      var dateStr = view.year + '-' + m + '-' + d;
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-cell';
      cell.textContent = String(day);

      if (checkins[dateStr]) {
        cell.classList.add('checked');
        hasAnyRecord = true;
        cell.addEventListener('click', function (ds) {
          return function () { showDetail(ds); };
        }(dateStr));
      } else if (dateStr > today) {
        cell.classList.add('future'); // 还没到的日子：能看不能点（E8）
        cell.disabled = true;
      } else if (dateStr === today) {
        cell.classList.add('today'); // 今天：描边提醒，打了卡会同时带 checked
      }
      if (dateStr === today && checkins[dateStr]) cell.classList.add('today');

      calGrid.appendChild(cell);
    }

    // 空状态（E1）：一条记录都没有时，把提示换成引导文案
    if (Object.keys(checkins).length === 0) {
      calHint.textContent = '还没有记录，今天先去打一个吧。';
    } else {
      calHint.textContent = '绿色是打了卡的日子，点一下能看当天详情；还没到的那天点不了。';
    }
  }

  /* ---- 单日详情（A7） ---- */

  // 往详情区加一行「标签：内容」；内容为空就不显示这一行
  function addDetailLine(label, value) {
    if (value === '' || value === null || value === undefined) return;
    var p = document.createElement('p');
    p.className = 'detail-line';
    var strong = document.createElement('span');
    strong.className = 'detail-label';
    strong.textContent = label + '：';
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    detailBody.appendChild(p);
  }

  function showDetail(dateStr) {
    var record = window.dhlStorage.getCheckins()[dateStr];
    if (!record) return; // 理论上不会发生（只有打了卡的格子可点）

    detailTitle.textContent = dateStr + ' 的记录';
    detailBody.innerHTML = '';

    var exText = '';
    if (record.exerciseType && record.exerciseMinutes !== '') {
      exText = record.exerciseType + ' ' + record.exerciseMinutes + ' 分钟';
      if (record.exerciseCalories) exText += ' ≈ ' + record.exerciseCalories + ' 大卡';
    }
    addDetailLine('运动', exText);
    addDetailLine('早餐', joinMeal(record.mealBreakfastText, record.mealBreakfastTag));
    addDetailLine('午餐', joinMeal(record.mealLunchText, record.mealLunchTag));
    addDetailLine('晚餐', joinMeal(record.mealDinnerText, record.mealDinnerTag));
    addDetailLine('体重', record.weightKg === '' ? '' : record.weightKg + ' kg');
    addDetailLine('饮水', record.waterMl === '' ? '' : record.waterMl + ' ml');

    if (!detailBody.children.length) {
      addDetailLine('提示', '这条记录内容是空的');
    }
    detailCard.hidden = false;
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function joinMeal(text, tag) {
    var t = text || '';
    if (tag) t += (t ? '（' + tag + '）' : tag);
    return t;
  }

  /* ---- 上/下月切换（E8） ---- */

  prevBtn.addEventListener('click', function () {
    view.month--;
    if (view.month < 1) { view.month = 12; view.year--; }
    renderCalendar();
  });

  nextBtn.addEventListener('click', function () {
    view.month++;
    if (view.month > 12) { view.month = 1; view.year++; }
    renderCalendar();
  });

  init();
})();
