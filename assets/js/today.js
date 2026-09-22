/* ============================================
   today.js —— 今日打卡页逻辑
   第 2 步：目标设置（PRD F1）
   第 3 步：今日打卡表单（PRD F2）+ validate.js + calories.js
   第 4 步：streak 大字区 + 目标提醒条（PRD F5），统计来自 stats.js
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

  /* ============ 一、目标设置（F1） ============ */

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
  var checkinCard = document.getElementById('checkin-card');
  var streakCard = document.getElementById('streak-card');
  var streakCurrent = document.getElementById('streak-current');
  var streakLongest = document.getElementById('streak-longest');
  var reminderBar = document.getElementById('reminder-bar');

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
    checkinCard.hidden = true;   // 没设目标前，打卡表单先不出现（PRD F1）
    streakCard.hidden = true;    // streak 与提醒条也等目标就位后再出现
    reminderBar.hidden = true;
  }

  function showGoalCard(settings) {
    goalText.textContent = '今日目标：运动 ' + settings.goalExerciseMinutes +
      ' 分钟 · 饮水 ' + settings.goalWaterMl + ' ml';
    settingsCard.hidden = true;
    goalCard.hidden = false;
    checkinCard.hidden = false;  // 目标就位，打卡表单出现
    streakCard.hidden = false;
    reminderBar.hidden = false;
    renderStreak();
    renderReminder();
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

  /* ============ 二、今日打卡表单（F2） ============ */

  var checkinForm = document.getElementById('checkin-form');
  var typeSelect = document.getElementById('exercise-type');
  var minutesInput = document.getElementById('exercise-minutes');
  var mealInputs = {
    breakfast: document.getElementById('breakfast-text'),
    lunch: document.getElementById('lunch-text'),
    dinner: document.getElementById('dinner-text')
  };
  var weightInput = document.getElementById('weight-kg');
  var waterInput = document.getElementById('water-ml');
  var exerciseError = document.getElementById('exercise-error');
  var weightError = document.getElementById('weight-error');
  var waterError = document.getElementById('water-error');
  var saveError = document.getElementById('checkin-save-error');
  var statusText = document.getElementById('checkin-status');
  var calorieNote = document.getElementById('calorie-note');

  var MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];

  // 读取某餐当前选中的标签（没选返回 ''）
  function getSelectedTag(meal) {
    var group = document.querySelector('.tag-group[data-meal="' + meal + '"]');
    var active = group ? group.querySelector('.tag.active') : null;
    return active ? active.getAttribute('data-tag') : '';
  }

  // 标签按钮：点一下选中（同组互斥），再点一下取消
  document.querySelectorAll('.tag-group').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var btn = e.target.closest('.tag');
      if (!btn) return;
      var wasActive = btn.classList.contains('active');
      group.querySelectorAll('.tag').forEach(function (t) { t.classList.remove('active'); });
      if (!wasActive) btn.classList.add('active');
    });
  });

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // 把当天已有记录填回表单（刷新后回填用，字段名见 TECH_DESIGN 2.2）
  function fillFormWithRecord(record) {
    typeSelect.value = record.exerciseType || '';
    minutesInput.value = record.exerciseMinutes === '' ? '' : record.exerciseMinutes;
    MEAL_KEYS.forEach(function (meal) {
      mealInputs[meal].value = record['meal' + capitalize(meal) + 'Text'] || '';
      var tag = record['meal' + capitalize(meal) + 'Tag'] || '';
      var group = document.querySelector('.tag-group[data-meal="' + meal + '"]');
      group.querySelectorAll('.tag').forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tag') === tag);
      });
    });
    weightInput.value = record.weightKg === '' ? '' : record.weightKg;
    waterInput.value = record.waterMl === '' ? '' : record.waterMl;
  }

  function setStatus(text) {
    statusText.textContent = text;
    statusText.hidden = false;
  }

  // 校验失败时在对应字段旁显示红字
  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
  }

  checkinForm.addEventListener('submit', function (e) {
    e.preventDefault();

    // 清掉上一轮的红字和状态
    [exerciseError, weightError, waterError, saveError].forEach(function (el) { el.hidden = true; });
    MEAL_KEYS.forEach(function (meal) {
      document.getElementById(meal + '-error').hidden = true;
    });
    statusText.hidden = true;
    calorieNote.hidden = true;

    // ---- 逐项校验（E5：非法值拦截） ----
    var minutes = window.dhlValidate.exerciseMinutes(minutesInput.value);
    if (!minutes.ok) { showError(exerciseError, minutes.message); return; }
    var weight = window.dhlValidate.weightKg(weightInput.value);
    if (!weight.ok) { showError(weightError, weight.message); return; }
    var water = window.dhlValidate.waterMl(waterInput.value);
    if (!water.ok) { showError(waterError, water.message); return; }

    var meals = {};
    var mealBad = false;
    MEAL_KEYS.forEach(function (meal) {
      var r = window.dhlValidate.mealText(mealInputs[meal].value);
      if (!r.ok) {
        showError(document.getElementById(meal + '-error'), r.message);
        mealBad = true;
      }
      meals[meal] = { text: r.value, tag: getSelectedTag(meal) };
    });
    if (mealBad) return;

    // ---- 全空拦截（E3：至少填一项） ----
    var hasExercise = typeSelect.value !== '' && minutes.value !== '' && minutes.value > 0;
    var hasMeal = MEAL_KEYS.some(function (meal) {
      return meals[meal].text !== '' || meals[meal].tag !== '';
    });
    var hasWeight = weight.value !== '';
    var hasWater = water.value !== '';
    if (!hasExercise && !hasMeal && !hasWeight && !hasWater) {
      showError(saveError, '至少填一项再保存哦');
      return;
    }

    // ---- 组装单日记录（字段名与 TECH_DESIGN 2.2 一致，camelCase） ----
    var date = todayStr();
    var calories = 0;
    if (hasExercise) {
      calories = window.dhlCalories.estimate(typeSelect.value, minutes.value);
    }
    var record = {
      date: date,
      exerciseType: hasExercise ? typeSelect.value : '',
      exerciseMinutes: hasExercise ? minutes.value : '',
      exerciseCalories: hasExercise ? calories : '',
      mealBreakfastText: meals.breakfast.text,
      mealBreakfastTag: meals.breakfast.tag,
      mealLunchText: meals.lunch.text,
      mealLunchTag: meals.lunch.tag,
      mealDinnerText: meals.dinner.text,
      mealDinnerTag: meals.dinner.tag,
      weightKg: weight.value,
      waterMl: water.value
    };

    // ---- 写入 localStorage（E7 失败要明说，不假装成功） ----
    var result = window.dhlStorage.saveCheckin(date, record);
    if (!result.ok) {
      showError(saveError, '没存上，检查一下浏览器存储设置再试试');
      return;
    }

    // ---- 首次打卡：把开始使用日期写进设置（坚持率分母用） ----
    var settings = window.dhlStorage.getSettings();
    if (settings && !settings.startDate) {
      settings.startDate = date;
      window.dhlStorage.saveSettings(settings);
    }

    // ---- 保存后的页面反馈（E6：覆盖时提示“已更新”） ----
    setStatus(result.isNew ? '今日已打卡 ✓' : '已更新今日记录');
    if (calories > 0) {
      calorieNote.textContent = typeSelect.value + ' ' + minutes.value + ' 分钟 ≈ ' + calories + ' 大卡';
      calorieNote.hidden = false;
    }

    // 打卡内容变了，streak 和提醒条跟着刷新
    renderStreak();
    renderReminder();
  });

  /* ============ 三、streak 大字区 + 目标提醒条（F5） ============ */

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

  /* ============ 四、页面初始化 ============ */

  function init() {
    window.dhlStorage.ensureMeta();

    // 目标设置：有 → 显示目标卡片；无 → 显示设置表单（打卡表单保持隐藏）
    var settings = window.dhlStorage.getSettings();
    if (isValidSettings(settings)) {
      showGoalCard(settings);
    } else {
      showSettingsForm();
      return; // 还没设目标，打卡部分不用管
    }

    // 当天已有记录 → 回填表单 + 显示已打卡状态（A4 验收项）
    var today = window.dhlStorage.getCheckins()[todayStr()];
    if (today) {
      fillFormWithRecord(today);
      setStatus('今日已打卡 ✓');
      if (today.exerciseCalories && today.exerciseType) {
        calorieNote.textContent = today.exerciseType + ' ' + today.exerciseMinutes +
          ' 分钟 ≈ ' + today.exerciseCalories + ' 大卡';
        calorieNote.hidden = false;
      }
    }
  }

  init();
})();
