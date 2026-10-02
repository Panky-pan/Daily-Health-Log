/* ============================================
   today.js —— 今日页逻辑（Day 14 起本页不再放表单）
   第 2 步：目标设置（PRD F1）
   第 4 步：streak 大字区 + 目标提醒条（PRD F5），统计来自 stats.js
   第 14 天：今日饮食健康分卡片（PRD 6.4），分值由 stats.js 实时算，不存库
   第 14 天板块 A：打卡表单搬去 checkin.html，本页改成"概览 + 入口"，
                  只留今日目标（含提醒条）、打卡入口、连续天数、健康分四块。
                  表单逻辑（校验/保存/回填）全部迁到 checkin.js，本页不再引用
                  calories.js 与 validate.js。
   ============================================ */

(function () {
  'use strict';

  /* ============ 通用工具 ============ */

  // 今天的本地日期（GMT+8 语义），格式 YYYY-MM-DD，全项目统一用这个
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 三餐统一口径：入口卡摘要和健康分明细都要按 早餐/午餐/晚餐 的顺序走
  var MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // 标签图标只用于页面显示；存储值仍是纯文字「健康/普通/放纵」（PRD 6.4「界面文案」）
  var TAG_ICONS = { '健康': '🥗', '普通': '🍚', '放纵': '🍔' };

  /* ============ 一、页面元素 ============ */

  var settingsCard = document.getElementById('settings-card');
  var goalCard = document.getElementById('goal-card');
  var goalText = document.getElementById('goal-text');
  var settingsForm = document.getElementById('settings-form');
  var exerciseGoalInput = document.getElementById('goal-exercise');
  var waterGoalInput = document.getElementById('goal-water');
  var exerciseGoalError = document.getElementById('goal-exercise-error');
  var waterGoalError = document.getElementById('goal-water-error');
  var settingsSaveError = document.getElementById('settings-save-error');
  var changeGoalBtn = document.getElementById('btn-change-goal');
  var entryCard = document.getElementById('checkin-entry-card');
  var entryHint = document.getElementById('checkin-entry-hint');
  var entryBtn = document.getElementById('checkin-entry-btn');
  var streakCard = document.getElementById('streak-card');
  var streakCurrent = document.getElementById('streak-current');
  var streakLongest = document.getElementById('streak-longest');
  var reminderBar = document.getElementById('reminder-bar');
  var dietCard = document.getElementById('diet-card');
  var dietScoreNum = document.getElementById('diet-score-num');
  var dietScoreMax = document.getElementById('diet-score-max');
  var dietScoreHint = document.getElementById('diet-score-hint');

  /* ============ 二、目标设置（F1） ============ */

  function isValidMinutes(v) {
    return Number.isInteger(v) && v >= 1 && v <= 600;
  }
  function isValidWater(v) {
    return Number.isInteger(v) && v >= 1 && v <= 10000;
  }
  function isValidSettings(s) {
    return !!s && isValidMinutes(s.goalExerciseMinutes) && isValidWater(s.goalWaterMl);
  }

  function showSettingsForm() {
    goalCard.hidden = true;
    settingsCard.hidden = false;
    entryCard.hidden = true;     // 没设目标前，打卡入口先不出现（PRD F1）
    streakCard.hidden = true;    // streak 与提醒条也等目标就位后再出现
    dietCard.hidden = true;      // 健康分卡片同理，等目标就位后再出现
  }

  function showGoalCard(settings) {
    goalText.textContent = '今日目标：运动 ' + settings.goalExerciseMinutes +
      ' 分钟 · 饮水 ' + settings.goalWaterMl + ' ml';
    settingsCard.hidden = true;
    goalCard.hidden = false;
    entryCard.hidden = false;
    streakCard.hidden = false;
    dietCard.hidden = false;
    renderStreak();
    renderReminder();
    renderCheckinEntry();
    renderDietScore();
  }

  settingsForm.addEventListener('submit', function (e) {
    e.preventDefault();
    exerciseGoalError.hidden = true;
    waterGoalError.hidden = true;
    settingsSaveError.hidden = true;

    var minutes = Number(exerciseGoalInput.value);
    var water = Number(waterGoalInput.value);

    var bad = false;
    if (!isValidMinutes(minutes)) {
      exerciseGoalError.textContent = '请填 1~600 的整数分钟';
      exerciseGoalError.hidden = false;
      bad = true;
    }
    if (!isValidWater(water)) {
      waterGoalError.textContent = '请填 1~10000 的整数 ml';
      waterGoalError.hidden = false;
      bad = true;
    }
    if (bad) return;

    var ok = window.dhlStorage.saveSettings({
      goalExerciseMinutes: minutes,
      goalWaterMl: water
    });
    if (!ok) {
      settingsSaveError.textContent = '没存上，检查一下浏览器存储设置再试试';
      settingsSaveError.hidden = false;
      return;
    }
    showGoalCard({ goalExerciseMinutes: minutes, goalWaterMl: water });
  });

  changeGoalBtn.addEventListener('click', function () {
    var settings = window.dhlStorage.getSettings();
    if (isValidSettings(settings)) {
      exerciseGoalInput.value = settings.goalExerciseMinutes;
      waterGoalInput.value = settings.goalWaterMl;
    }
    showSettingsForm();
  });

  /* ============ 三、打卡入口卡（Day 14 板块 A） ============ */

  // 三餐摘要：把三顿的标签图标按早/午/晚顺序并成一串（如 🥗🥗🍔）。
  // 一个标签都没有 → 返回空串，摘要里就不出现这一段（和"没记饮食"的口径一致）
  // Day 14 测试 #1：用户回来是想"核对记了啥"，摘要里没有三餐就得再点进修改页才能确认
  function buildMealTagsPart(record) {
    var icons = '';
    var tagged = false;
    MEAL_KEYS.forEach(function (meal) {
      var tag = record['meal' + capitalize(meal) + 'Tag'];
      if (Object.prototype.hasOwnProperty.call(TAG_ICONS, tag)) {
        icons += TAG_ICONS[tag];
        tagged = true;
      }
    });
    return tagged ? '三餐 ' + icons : '';
  }

  // 已打卡时把当天记到的东西拼成一行摘要，回填成"我今天记了什么"的提示
  function buildRecordSummary(record) {
    var parts = [];
    if (record.exerciseType && Number(record.exerciseMinutes) > 0) {
      parts.push(record.exerciseType + ' ' + record.exerciseMinutes + ' 分钟');
    }
    var mealsPart = buildMealTagsPart(record);
    if (mealsPart) parts.push(mealsPart);
    if (record.waterMl !== '' && record.waterMl !== undefined) {
      parts.push('饮水 ' + record.waterMl + ' ml');
    }
    if (record.weightKg !== '' && record.weightKg !== undefined) {
      parts.push('体重 ' + record.weightKg + ' kg');
    }
    return parts.join(' · ');
  }

  // 今天没记录 → 引导去记；已记录 → 报一句"记了啥"并把按钮换成"修改记录"
  // （每次打开本页都会重算，所以从 checkin.html 跳回来立刻就是最新的）
  function renderCheckinEntry() {
    var record = window.dhlStorage.getCheckins()[todayStr()];
    if (!record) {
      entryHint.textContent = '今天还没记，花一分钟填一下运动、三餐和饮水吧。';
      entryBtn.textContent = '去打卡';
      return;
    }
    var summary = buildRecordSummary(record);
    entryHint.textContent = summary
      ? '今天已经记过了：' + summary
      : '今天已经记过了，点一下可以改。';
    entryBtn.textContent = '修改记录';
  }

  /* ============ 四、streak 大字区 + 目标提醒条（F5） ============ */

  // 顶部两个大数字：当前连续 / 历史最长（口径在 stats.js，PRD F3）
  function renderStreak() {
    var checkins = window.dhlStorage.getCheckins();
    streakCurrent.textContent = window.dhlStats.currentStreak(checkins, todayStr());
    streakLongest.textContent = window.dhlStats.longestStreak(checkins);
  }

  // 提醒条：未打卡/未达标 → 黄色写差值；达标 → 绿色（PRD F5）
  // 某项没填按 0 计算，照样提醒差值（F5 与 E3 的交互要求）
  function renderReminder() {
    var settings = window.dhlStorage.getSettings();
    if (!isValidSettings(settings)) return;

    var record = window.dhlStorage.getCheckins()[todayStr()];
    var exDone = Number(record && record.exerciseMinutes) || 0;
    var waterDone = Number(record && record.waterMl) || 0;
    var exMiss = settings.goalExerciseMinutes - exDone;
    var waterMiss = settings.goalWaterMl - waterDone;

    var parts = [];
    if (exMiss > 0) parts.push('运动还差 ' + exMiss + ' 分钟');
    if (waterMiss > 0) parts.push('饮水还差 ' + waterMiss + ' ml');

    if (record && parts.length === 0) {
      // 已打卡且两项都达标 → 绿色
      reminderBar.textContent = '今日目标已达成 ✓';
      reminderBar.classList.remove('reminder-warn');
      reminderBar.classList.add('reminder-ok');
    } else {
      // 未打卡或未达标 → 黄色，写清差多少
      var lead = record ? '今天还差一点：' : '今天还没打卡，';
      reminderBar.textContent = lead + parts.join(' · ') + '，加油！';
      reminderBar.classList.remove('reminder-ok');
      reminderBar.classList.add('reminder-warn');
    }
    reminderBar.hidden = false;
  }

  /* ============ 五、今日饮食健康分卡片（PRD 6.4） ============ */

  // TAG_ICONS / MEAL_KEYS / capitalize 已提到文件头部的通用工具区（入口卡摘要也要用）
  var MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' };

  // 有标签 → 显示「4 / 6 分」+ 每餐明细；三餐都没打标签 → 显示「—」+ 引导文案，
  // 不显示 0/6（PRD 6.4：免得把"没记"误读成"吃得最差"）
  function renderDietScore() {
    var record = window.dhlStorage.getCheckins()[todayStr()];
    var result = window.dhlStats.dietScore(record);

    if (result.score === null) {
      dietScoreNum.textContent = '—';
      dietScoreMax.hidden = true;
      dietScoreHint.textContent = '今天还没记饮食，三餐随便点一个标签就有分了。';
      return;
    }

    dietScoreNum.textContent = result.score;
    dietScoreMax.textContent = '/ ' + result.max + ' 分';
    dietScoreMax.hidden = false;

    // 明细只列打了标签的餐（没打标签的餐不计分，也就不在这儿占位置）
    var parts = [];
    MEAL_KEYS.forEach(function (meal) {
      var tag = record['meal' + capitalize(meal) + 'Tag'];
      if (!Object.prototype.hasOwnProperty.call(TAG_ICONS, tag)) return;
      parts.push(TAG_ICONS[tag] + ' ' + MEAL_LABELS[meal] + ' ' +
        window.dhlStats.DIET_TAG_SCORES[tag] + ' 分');
    });
    dietScoreHint.textContent = parts.join(' · ');
  }

  /* ============ 六、页面初始化 ============ */

  function init() {
    window.dhlStorage.ensureMeta();

    // 目标设置：有 → 显示概览四块；无 → 只显示设置表单
    var settings = window.dhlStorage.getSettings();
    if (isValidSettings(settings)) {
      showGoalCard(settings);
    } else {
      showSettingsForm();
    }
  }

  // Day 17：先等云端数据取回来再渲染（取不到会自动回落本地数据，不会白屏）
  if (window.dhlApi) { window.dhlApi.ready(init); } else { init(); }
})();
