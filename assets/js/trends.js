/* ============================================
   trends.js —— 趋势页逻辑（PRD F4 / E4）
   - 体重折线图：按有体重记录的日期连成线
   - 每周运动时长柱状图：近 8 周（周一~周日），口径在 stats.js
   - 数据不足（E4）不画空图、不显示 NaN，只给引导文案
   Chart.js 用本地文件（assets/js/vendor/chart.umd.js），离线可用。
   ============================================ */

(function () {
  'use strict';

  /* ---- 页面元素 ---- */
  var weightBox = document.getElementById('weight-box');
  var weightEmpty = document.getElementById('weight-empty');
  var exerciseBox = document.getElementById('exercise-box');
  var exerciseEmpty = document.getElementById('exercise-empty');

  // 与 CSS 变量一致的色值（Chart.js 读不了 CSS 变量，这里写死并注明来源）
  var GREEN = '#4C9A5F';        // --color-green
  var GREEN_LIGHT = '#5BA85F';  // --color-green-light
  var TEXT = '#2F3B2F';         // --color-text
  var MUTED = '#7A8471';        // --color-muted
  var BORDER = '#E8E0CC';       // --color-border

  // 图表通用字体，和页面一致
  Chart.defaults.font.family = '"PingFang SC", "Microsoft YaHei", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = MUTED;

  /* ---- 体重折线图 ---- */

  function renderWeightChart(checkins) {
    // 只取填了体重的日子，按日期从旧到新
    var points = Object.keys(checkins)
      .filter(function (d) {
        var w = checkins[d].weightKg;
        return w !== '' && w !== null && w !== undefined && isFinite(Number(w));
      })
      .sort()
      .map(function (d) {
        return { date: d, kg: Number(checkins[d].weightKg) };
      });

    // E4：少于 2 个点画不出折线 → 引导文案，不初始化图表
    if (points.length < 2) {
      weightBox.hidden = true;
      weightEmpty.hidden = false;
      return;
    }

    var p = Number(points[points.length - 1].kg); // 纵轴围绕数据范围自适应即可
    new Chart(document.getElementById('weight-chart'), {
      type: 'line',
      data: {
        labels: points.map(function (pt) { return pt.date.slice(5); }), // '09/22' → '9/22' 风格
        datasets: [{
          label: '体重（kg）',
          data: points.map(function (pt) { return pt.kg; }),
          borderColor: GREEN,
          backgroundColor: GREEN_LIGHT,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: BORDER } },
          y: {
            grid: { color: BORDER },
            title: { display: true, text: 'kg', color: TEXT }
          }
        }
      }
    });
  }

  /* ---- 每周运动柱状图 ---- */

  function renderExerciseChart(checkins, today) {
    // 近 8 周（含当前周），周一~周日，口径在 stats.js
    var weeks = window.dhlStats.weeklyExercise(checkins, today, 8);

    // E4：8 周内一条运动记录都没有 → 引导文案，不画空图
    var total = weeks.reduce(function (s, w) { return s + w.minutes; }, 0);
    if (total === 0) {
      exerciseBox.hidden = true;
      exerciseEmpty.hidden = false;
      return;
    }

    new Chart(document.getElementById('exercise-chart'), {
      type: 'bar',
      data: {
        labels: weeks.map(function (w) { return w.label; }),
        datasets: [{
          label: '运动分钟',
          data: weeks.map(function (w) { return w.minutes; }),
          backgroundColor: GREEN_LIGHT,
          borderRadius: 6,
          maxBarThickness: 36
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: BORDER },
            title: { display: true, text: '分钟', color: TEXT }
          }
        }
      }
    });
  }

  /* ---- 初始化 ---- */

  var checkins = window.dhlStorage.getCheckins();
  var today = window.dhlStats.formatDate(new Date());
  renderWeightChart(checkins);
  renderExerciseChart(checkins, today);
})();
