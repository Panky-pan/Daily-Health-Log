/* ============================================
   checkin.js —— 打卡独立页逻辑（Day 14 板块 A，Day 18 接云端写入）
   这一页的职责只有一个：把今天的记录填好、存下来、然后回今日页。
   - 表单字段、校验规则、存储结构都沿用原来的打卡卡片，没有新口径
   - 只依赖 storage / api-source / calories / validate 四个文件
   保存策略（Day 18 拍板方案 A「云端优先 + 本地兜底」）：
     先 PUT 云端（A6），成功 → 更新内存覆盖层，回今日页看到的就是新值；
     失败 → 回落写本地，并明说「已存本机」，绝不假装成功（PRD E7）。
   保存成功后停在页面约 0.9 秒，让用户看到「已存好」再自动返回 index.html。
   ============================================ */

(function () {
  'use strict';

  // 返回今日页前的停顿：太短看不清提示，太长又像卡住了
  var BACK_DELAY_MS = 900;

  // 今天的本地日期（GMT+8 语义），格式 YYYY-MM-DD，与 today.js 同一口径
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function isValidMinutes(v) {
    return Number.isInteger(v) && v >= 1 && v <= 600;
  }
  function isValidWater(v) {
    return Number.isInteger(v) && v >= 1 && v <= 10000;
  }
  function isValidSettings(s) {
    return !!s && isValidMinutes(s.goalExerciseMinutes) && isValidWater(s.goalWaterMl);
  }

  /* ============ 一、DOM 引用 ============ */

  var noGoalCard = document.getElementById('no-goal-card');
  var checkinCard = document.getElementById('checkin-card');
  var goalHint = document.getElementById('checkin-goal-hint');

  var checkinForm = document.getElementById('checkin-form');
  var submitBtn = document.getElementById('checkin-submit');
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

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ============ 二、标签按钮与回填 ============ */

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

  // 把当天已有记录填回表单（从今日页的「修改记录」进来时用，字段名见 TECH_DESIGN 2.2）
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

  // 保存中/返回中：锁住按钮，避免连点存两次
  function lockSubmit(text) {
    submitBtn.textContent = text;
    submitBtn.disabled = true;
  }

  // 记住按钮的初始文案（HTML 里写的那句），失败后好恢复
  submitBtn.dataset.defaultText = submitBtn.textContent;

  /* ============ 三、保存 ============ */

  /**
   * 保存成功后的收尾：给定文案 → 显示卡路里 → 锁按钮 → 延时回今日页。
   * @param {boolean} isNew 是新建（true）还是覆盖了原有记录（false）
   * @param {number} calories 本次估算出的卡路里（0 = 没记运动）
   */
  function finishSave(isNew, calories) {
    // 就地给反馈，然后回今日页看结果（E6 覆盖时提示「已更新」）
    setStatus(isNew ? '今日已打卡 ✓ 正在返回…' : '已更新今日记录，正在返回…');
    if (calories > 0) {
      calorieNote.textContent = typeSelect.value + ' ' + minutesInput.value + ' 分钟 ≈ ' + calories + ' 大卡';
      calorieNote.hidden = false;
    }
    lockSubmit(isNew ? '已打卡，返回中…' : '已更新，返回中…');
    window.setTimeout(function () {
      window.location.href = 'index.html';
    }, BACK_DELAY_MS);
  }

  // 提交中：按钮换文案并锁住（云端往返期间防止连点）
  function showSaving() {
    lockSubmit('正在保存…');
  }

  // 提交失败后恢复按钮，让用户可以改完再存一次
  function unlockSubmit() {
    submitBtn.textContent = submitBtn.dataset.defaultText || '保存今日打卡';
    submitBtn.disabled = false;
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

    // ---- 写入：先云端（A6），失败才回落本地（方案 A） ----
    showSaving();

    // 云端不可用（脚本没加载出来，理论上不会）→ 直接走本地兜底，别卡住页面
    if (!window.dhlApi || typeof window.dhlApi.saveCheckin !== 'function') {
      saveLocally(date, record, calories, '云端连接没加载上，先存本机了');
      return;
    }

    window.dhlApi.saveCheckin(date, record).then(function (res) {
      if (res.ok) {
        // 云端存上了：更新内存覆盖层，页面立刻就是新值；本地那份不动（方案 A）
        window.dhlStorage.putRemoteCheckin(date, res.record || record);
        ensureStartDate(date);
        finishSave(res.isNew, calories);
        return;
      }
      // 云端没存上：回落本地，并明说存到哪了（E7：不假装成功）
      saveLocally(date, record, calories, res.message);
    });
  });

  /**
   * 本地兜底写入（云端写失败时用）。
   * 页面提示必须让用户知道「存哪了」——不然他会以为白填了。
   */
  function saveLocally(date, record, calories, reason) {
    var result = window.dhlStorage.saveCheckin(date, record);
    if (!result.ok) {
      showError(saveError, '没存上，检查一下浏览器存储设置再试试');
      unlockSubmit();
      return;
    }
    ensureStartDate(date);
    setStatus('云端暂时连不上（' + reason + '），已先存本机 ✓');
    if (calories > 0) {
      calorieNote.textContent = typeSelect.value + ' ' + minutesInput.value + ' 分钟 ≈ ' + calories + ' 大卡';
      calorieNote.hidden = false;
    }
    lockSubmit('已存本机，返回中…');
    window.setTimeout(function () {
      window.location.href = 'index.html';
    }, BACK_DELAY_MS);
  }

  // 首次打卡：把开始使用日期写进设置（坚持率分母用）。已有则不动（契约 3.3 规则 2）
  function ensureStartDate(date) {
    var settings = window.dhlStorage.getSettings();
    if (settings && !settings.startDate) {
      settings.startDate = date;
      window.dhlStorage.saveSettings(settings);
    }
  }

  /* ============ 四、页面初始化 ============ */

  function init() {
    window.dhlStorage.ensureMeta();

    // 没设目标不让打卡（PRD F1）：显示兜底卡片，给一条回今日页的路
    var settings = window.dhlStorage.getSettings();
    if (!isValidSettings(settings)) {
      noGoalCard.hidden = false;
      return;
    }

    // 打卡前先亮出今日目标，填的时候心里有数
    goalHint.textContent = '今日目标：运动 ' + settings.goalExerciseMinutes +
      ' 分钟 · 饮水 ' + settings.goalWaterMl + ' ml';
    checkinCard.hidden = false;

    // 当天已有记录 → 回填表单 + 提示可以在原记录上改
    var today = window.dhlStorage.getCheckins()[todayStr()];
    if (today) {
      fillFormWithRecord(today);
      setStatus('今天已经记过了，改完再存会覆盖原来那条');
      submitBtn.textContent = '更新今日打卡';
      if (today.exerciseCalories && today.exerciseType) {
        calorieNote.textContent = today.exerciseType + ' ' + today.exerciseMinutes +
          ' 分钟 ≈ ' + today.exerciseCalories + ' 大卡';
        calorieNote.hidden = false;
      }
    }
  }

  // Day 17：先等云端数据取回来再回填表单（取不到会自动回落本地数据，不会白屏）
  if (window.dhlApi) { window.dhlApi.ready(init); } else { init(); }
})();
