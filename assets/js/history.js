/* ============================================
   history.js —— 历史记录页逻辑（PRD F3 / E8）
   - 统计行（日历卡首行）：当前连续 / 历史最长 / 坚持率（口径全在 stats.js）
   - 当月日历：打卡日绿色标记、今天描边、未来日期不可点（E8）
   - 上/下月切换（E8 跨月）
   - 点已打卡的日子 → 下方显示单日详情（A7）；Day 13 补「返回日历」
   - Day 14：单日详情补「饮食健康分」（PRD 6.4），分值由 stats.js 实时算
   - Day 13：筛选列表补四态（加载中/有结果/没有结果/失败），?state= 调试，
     取数走 state.js 的 fetchList（Promise，接真接口只改 state.js）
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
  var backBtn = document.getElementById('btn-back-cal');
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

  // 统计行（Day 14 收尾：从独立统计卡并进日历卡首行，DOM 结构换了但 id 没换）
  // 一个数字都不改算法，只换位置——所以这个函数本身没动
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
      calHint.textContent = '绿色是打过卡的日子，点一下看当天详情。';
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

    // 当天饮食健康分（PRD 6.4）：派生值，按当天标签实时算；
    // 三餐一个标签都没打时是「没有分数」，这行就不出现（不显示 0 分）
    var diet = window.dhlStats.dietScore(record);
    if (diet.score !== null) {
      addDetailLine('饮食健康分', diet.score + ' / ' + diet.max + ' 分');
    }

    addDetailLine('体重', record.weightKg === '' ? '' : record.weightKg + ' kg');
    addDetailLine('饮水', record.waterMl === '' ? '' : record.waterMl + ' ml');

    if (!detailBody.children.length) {
      addDetailLine('提示', '这条记录内容是空的');
    }
    detailCard.hidden = false;
    backBtn.hidden = false; // 返回按钮随详情一起出现
    detailCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 「返回日历」：收起详情卡（回到第 2 级视图），视线滚回日历
  backBtn.addEventListener('click', function () {
    detailCard.hidden = true;
    backBtn.hidden = true;
    detailBody.innerHTML = ''; // 顺手清掉上一次的内容
    calGrid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

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

  /* ---- Day 12：按饮食标签筛选（frontend-guidelines skill 实战） ----
     数据只读不写：扫全部打卡记录的三餐 Tag，不碰 localStorage 写接口 */

  var filterGroup = document.getElementById('meal-tag-filter');
  var filterResult = document.getElementById('filter-result');

  var MEALS = [
    { label: '早餐', tagKey: 'mealBreakfastTag', textKey: 'mealBreakfastText' },
    { label: '午餐', tagKey: 'mealLunchTag',    textKey: 'mealLunchText' },
    { label: '晚餐', tagKey: 'mealDinnerTag',   textKey: 'mealDinnerText' }
  ];

  // 默认态 / 清空恢复：回到「还没选标签」的提示
  // Day 14：文案改短一行（历史页整体压缩，默认态少占一行高度）
  function showFilterDefault() {
    filterResult.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'filter-hint';
    p.textContent = '点上面的标签，翻出那天的记录。';
    filterResult.appendChild(p);
  }

  // 无结果空态：口语化文案，不给冷冰冰的「暂无数据」
  function showFilterEmpty(tag) {
    filterResult.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'filter-hint';
    p.textContent = '没有找到「' + tag + '」的记录，换个标签试试。';
    filterResult.appendChild(p);
  }

  // 有结果：按日期从新到旧，列出所有带该标签的餐次（数据由 state.js 给）
  function renderFilterHits(tag, hits) {
    filterResult.innerHTML = '';
    if (!hits.length) {
      showFilterEmpty(tag);
      return;
    }
    hits.forEach(function (hit) {
      var p = document.createElement('p');
      p.className = 'detail-line';
      var strong = document.createElement('span');
      strong.className = 'detail-label';
      strong.textContent = hit.date + ' · ' + hit.meal + '：';
      p.appendChild(strong);
      p.appendChild(document.createTextNode(hit.text ? hit.text + '（' + tag + '）' : tag));
      filterResult.appendChild(p);
    });
  }

  // 扫描逻辑从渲染里拆出来（Day 13）：只负责查数据，不碰 DOM。
  // 这样 state.js 的 fetchList 才能在「假装异步」结束后把结果交给渲染。
  function scanFilterHits(tag) {
    var checkins = window.dhlStorage.getCheckins();
    var dates = Object.keys(checkins).sort().reverse();
    var hits = [];
    dates.forEach(function (dateStr) {
      var rec = checkins[dateStr];
      MEALS.forEach(function (meal) {
        if (rec[meal.tagKey] === tag) {
          hits.push({ date: dateStr, meal: meal.label, text: rec[meal.textKey] || '' });
        }
      });
    });
    return hits;
  }

  /* ---- Day 13：筛选列表四态流程 ----
     点标签 → 加载中（骨架屏）→ 取数成功：有结果 / 没有结果
                            → 取数失败：出错提示 + 再试一次按钮
     ?state=loading / empty / error 可在地址栏强制进入对应状态 */

  var currentTag = ''; // 记录当前筛选的标签，「再试一次」要用
  var filterSeq = 0;   // 请求序号：连点两个标签时，只有最新一次的结果能上屏

  function showFilterLoading() {
    filterResult.innerHTML = '';
    // 骨架屏复用 Day 8 的 .skeleton-line（灰块呼吸动画，受减动效设置保护）；
    // 三行 + 最后一行短一截，暗示「这里马上会出现几行日期记录」
    for (var i = 0; i < 3; i++) {
      var div = document.createElement('div');
      div.className = 'skeleton-line' + (i === 2 ? ' skeleton-line-short' : '');
      filterResult.appendChild(div);
    }
  }

  function showFilterError(tag) {
    filterResult.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'filter-error';
    p.textContent = '记录暂时翻不出来了，稍后再试。';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.textContent = '再试一次';
    btn.addEventListener('click', function () { runFilter(tag); });
    filterResult.appendChild(p);
    filterResult.appendChild(btn);
  }

  function runFilter(tag) {
    currentTag = tag;
    var seq = ++filterSeq; // 领号：我是第几次请求
    showFilterLoading();
    window.dhlState.fetchList(function () { return scanFilterHits(tag); })
      .then(function (res) {
        if (seq !== filterSeq) return; // 已经有更新的请求，旧结果作废
        renderFilterHits(tag, res.items);
      })
      .catch(function () {
        if (seq !== filterSeq) return;
        showFilterError(tag);
      });
  }

  filterGroup.addEventListener('click', function (e) {
    var btn = e.target.closest('.tag');
    if (!btn) return;
    // 同组互斥：先全灭再点亮当前（复用 .tag.active 既有样式）
    var all = filterGroup.querySelectorAll('.tag');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
    btn.classList.add('active');

    var tag = btn.getAttribute('data-tag');
    if (tag === '') {
      currentTag = '';
      showFilterDefault();   // 点「全部」= 清空，恢复默认（不走异步）
    } else {
      runFilter(tag);
    }
  });

  // Day 17：先等云端数据取回来再渲染（取不到会自动回落本地数据，不会白屏）
  if (window.dhlApi) { window.dhlApi.ready(init); } else { init(); }
})();
