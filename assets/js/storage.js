/* ============================================
   storage.js —— localStorage 读写封装
   全项目唯一出入口：其他文件不许直接碰 localStorage，
   统一走这里，方便将来做容错（E7）和二期迁移。
   存储key约定（TECH_DESIGN 2.2）：
   - dhl:meta     结构版本号
   - dhl:settings 全局目标设置（只有一份）
   - dhl:checkins 以日期字符串为 key 的单日打卡对象
   ============================================ */

(function () {
  'use strict';

  var KEYS = {
    meta: 'dhl:meta',
    settings: 'dhl:settings',
    checkins: 'dhl:checkins'
  };

  /**
   * 读取一个 key 并解析 JSON。
   * 读不到 / 内容损坏（E2）时返回 fallback，绝不抛错、绝不白屏。
   */
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      // JSON 损坏或浏览器禁用存储：当首次使用处理（E2）
      return fallback;
    }
  }

  /**
   * 写入一个 key（JSON 序列化）。
   * 写失败（配额满 / 隐私模式，E7）返回 false，由调用方提示用户。
   */
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---- meta：数据结构版本号，首次访问时补写 ---- */
  function ensureMeta() {
    if (read(KEYS.meta, null) === null) {
      write(KEYS.meta, { schemaVersion: 1 });
    }
  }

  /* ---- settings：全局目标设置（PRD 6.2） ---- */
  // 读设置；没有返回 null（调用方据此判断“首次使用”→ 显示设置表单）
  function getSettings() {
    return read(KEYS.settings, null);
  }

  // 保存目标设置。成功返回 true，失败返回 false（E7）
  function saveSettings(settings) {
    return write(KEYS.settings, settings);
  }

  /* ---- checkins：单日打卡记录 ---- */
  // 读全部打卡记录，返回 { "2026-09-22": {...}, ... }；没有返回空对象
  function getCheckins() {
    return read(KEYS.checkins, {});
  }

  /**
   * 保存/覆盖某天的打卡记录（同一天重复保存 = 覆盖，E6 免费解决）。
   * 返回 { ok: true, isNew: true/false } 或 { ok: false }（写入失败，E7）。
   * 注意：startDate 在第一次打卡时自动写入设置（步骤 3 实现，此处不处理）。
   */
  function saveCheckin(date, record) {
    var all = getCheckins();
    var isNew = !Object.prototype.hasOwnProperty.call(all, date);
    all[date] = record;
    if (!write(KEYS.checkins, all)) {
      return { ok: false };
    }
    return { ok: true, isNew: isNew };
  }

  // 暴露给其他文件用的接口（挂到 window.dhlStorage 上）
  window.dhlStorage = {
    ensureMeta: ensureMeta,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getCheckins: getCheckins,
    saveCheckin: saveCheckin
  };
})();
