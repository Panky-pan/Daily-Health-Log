/* ============================================
   storage.js —— localStorage 读写封装
   全项目唯一出入口：其他文件不许直接碰 localStorage，
   统一走这里，方便将来做容错（E7）和二期迁移。
   存储key约定（TECH_DESIGN 2.2）：
   - dhl:meta              结构版本号（当前 2）
   - dhl:settings          全局目标设置（只有一份）
   - dhl:checkins          以日期字符串为 key 的单日打卡对象
   - dhl:checkins_backup_v1  v1→v2 迁移前的旧数据备份（只读，永不改写）

   一次性迁移（2026-09-29）：
   三餐标签由「清爽/标准/丰盛」改为「健康/普通/放纵」（PRD 6.4）。
   老用户第一次打开任意页面时自动转换一次，细节见 migrateIfNeeded()。

   **写**（Day 18 接上 A6）：打卡页保存时先 PUT 云端，成功后就地更新
   这个内存覆盖层（putRemoteCheckin），所以保存完立刻回今日页看到的就是新值，
   一刷新也从云端读回来，不会再"回退成旧记录"。
   只有云端写失败时才回落写本地（saveCheckin），页面上会明说"已存本机"。
   ============================================ */

(function () {
  'use strict';

  var KEYS = {
    meta: 'dhl:meta',
    settings: 'dhl:settings',
    checkins: 'dhl:checkins',
    backupV1: 'dhl:checkins_backup_v1'
  };

  // 当前数据结构版本（TECH_DESIGN 2.2）
  var SCHEMA_VERSION = 2;

  // v1 → v2 的三餐标签映射（2026-09-29 拍板：一对一）
  // 清爽 → 健康、标准 → 普通、丰盛 → 放纵
  var LEGACY_TAG_MAP = { '清爽': '健康', '标准': '普通', '丰盛': '放纵' };
  var MEAL_TAG_KEYS = ['mealBreakfastTag', 'mealLunchTag', 'mealDinnerTag'];

  // 最近一次迁移的结果，供页面/控制台查看（没迁过就是 null）
  var lastMigration = null;

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

  /* ---- meta：结构版本号 + 一次性迁移 ---- */

  /**
   * 把一条记录里的旧标签换成新标签（就地改）。
   * @returns {number} 这次换掉几个标签（0 = 本来就是新标签 / 空的餐次）
   */
  function convertRecordTags(record) {
    if (!record || typeof record !== 'object') return 0;
    var count = 0;
    MEAL_TAG_KEYS.forEach(function (key) {
      var value = record[key];
      // 用 hasOwnProperty 判断，避免 'constructor' 这类怪值被当成映射命中
      if (Object.prototype.hasOwnProperty.call(LEGACY_TAG_MAP, value)) {
        record[key] = LEGACY_TAG_MAP[value];
        count++;
      }
    });
    return count;
  }

  /**
   * 一次性数据迁移：v1 → v2（2026-09-29，TECH_DESIGN 2.2）
   * 做什么：三餐标签「清爽/标准/丰盛」→「健康/普通/放纵」。
   *
   * 三条安全措施（数据只在自己浏览器里，所以更要小心）：
   *   1. 改写前先把旧的整份 checkins 备份到 dhl:checkins_backup_v1；
   *      **备份已存在就不覆盖**——保证那份备份里永远是"迁移前"的原始数据；
   *   2. 迁移成功后写 schemaVersion: 2 —— 幂等：以后打开多少次都不会重复转换
   *      （也是防止把「健康」这类新标签再映射一遍）；
   *   3. 只动三餐标签值，其他字段和 dhl:settings 一概不碰；读不到数据（E2）
   *      时按"没有迁移可做"处理，不抛错、不白屏。
   *
   * @returns {boolean} 这次是否真的执行了迁移
   */
  function migrateIfNeeded() {
    var meta = read(KEYS.meta, null);
    var version = meta ? Number(meta.schemaVersion) : NaN;
    if (version >= SCHEMA_VERSION) return false; // 已是新版：直接收工

    var checkins = read(KEYS.checkins, null);
    var hasRecords = !!checkins && typeof checkins === 'object';

    // 全新用户（既没有版本号、也没有任何记录）：补写版本号，不算一次迁移
    if (!hasRecords && isNaN(version)) {
      write(KEYS.meta, { schemaVersion: SCHEMA_VERSION });
      return false;
    }

    var convertedTags = 0;
    if (hasRecords) {
      if (read(KEYS.backupV1, null) === null) {
        write(KEYS.backupV1, checkins); // 备份失败也不中断：写入本身有 try/catch
      }
      Object.keys(checkins).forEach(function (date) {
        convertedTags += convertRecordTags(checkins[date]);
      });
      write(KEYS.checkins, checkins);
    }
    write(KEYS.meta, { schemaVersion: SCHEMA_VERSION });

    lastMigration = {
      from: isNaN(version) ? 1 : version,
      to: SCHEMA_VERSION,
      tags: convertedTags
    };
    return true;
  }

  function ensureMeta() {
    // 先做迁移（meta 缺失但存着老数据时也能正确转换），再补写版本号
    migrateIfNeeded();
    if (read(KEYS.meta, null) === null) {
      write(KEYS.meta, { schemaVersion: SCHEMA_VERSION });
    }
  }

  /* ---- 云端覆盖层（Day 17 新增） ---- */
  // null = 还没取到云端数据（页面就用本地数据）；取到后读操作优先走这里。
  // 只在内存里，不写 localStorage —— 你的本地老数据一个字节都不会被动。
  var remote = null;

  /**
   * 把 api-source.js 取回的云端数据放进覆盖层。
   * @param {Object|null} settings 云端目标设置（A2），null = 云端还没设置过
   * @param {Object} checkins 以日期为 key 的打卡记录表（A4 的 items 转过来的）
   */
  function applyRemote(settings, checkins) {
    remote = { settings: settings, checkins: checkins || {} };
  }

  // 数据是不是来自云端（页面/控制台自查用）
  function isRemote() {
    return remote !== null;
  }

  /**
   * 云端写入成功后，把这条记录就地更新进覆盖层（Day 18，配合 A6）。
   *
   * 为什么不复用 saveCheckin：那个是写 localStorage 的。方案 A 之下云端写成功
   * 就**不该再写本地**（本地那份是"云端取不到时的兜底"，不是第二份数据源）。
   *
   * 为什么必须更新覆盖层：页面读数据走 getCheckins()，云端覆盖层一旦存在就
   * 优先读它。若不更新，保存后回今日页看到的还是保存前的旧值，且要等下次
   * 刷新重新 GET 才纠正 —— 表现出来就像"存了但没存上"。
   *
   * @param {string} date   日期 YYYY-MM-DD
   * @param {Object} record 保存后的完整记录（用云函数回传的那份，含服务端归一化结果）
   * @returns {boolean} 覆盖层是否处于生效状态（false = 云端数据没取到，本次走的是本地兜底）
   */
  function putRemoteCheckin(date, record) {
    if (!remote) return false;
    remote.checkins[date] = record;
    return true;
  }

  /* ---- settings：全局目标设置（PRD 6.2） ---- */
  // 读设置；没有返回 null（调用方据此判断“首次使用”→ 显示设置表单）
  function getSettings() {
    if (remote) return remote.settings;
    return read(KEYS.settings, null);
  }

  // 保存目标设置。成功返回 true，失败返回 false（E7）
  function saveSettings(settings) {
    return write(KEYS.settings, settings);
  }

  /* ---- checkins：单日打卡记录 ---- */
  // 读全部打卡记录，返回 { "2026-09-22": {...}, ... }；没有返回空对象
  function getCheckins() {
    var local = read(KEYS.checkins, {});
    if (!remote) return local;

    // 云端覆盖层生效时的合并规则：**以云端为准**，本地独有的日期保留。
    // 为什么保留本地的：本期只接了读接口，写还在本地（Day 18 才接 PUT），
    // 刚在打卡页保存的那天若不保留，一刷新就“消失”，看起来像丢数据。
    var merged = {};
    Object.keys(local).forEach(function (date) {
      merged[date] = local[date];
    });
    Object.keys(remote.checkins).forEach(function (date) {
      merged[date] = remote.checkins[date];
    });
    return merged;
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

  // 页面一打开就先做一次版本检查 + 迁移：
  // 只要某个页面引用了 storage.js（今日/历史/趋势页都引），
  // 后面读到的数据就一定已经是新版本了，页面脚本不用各自记得调用。
  migrateIfNeeded();

  // 暴露给其他文件用的接口（挂到 window.dhlStorage 上）
  window.dhlStorage = {
    ensureMeta: ensureMeta,
    migrateIfNeeded: migrateIfNeeded,
    getLastMigration: function () { return lastMigration; },
    BACKUP_KEY: KEYS.backupV1,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getCheckins: getCheckins,
    saveCheckin: saveCheckin,
    putRemoteCheckin: putRemoteCheckin,
    applyRemote: applyRemote,
    isRemote: isRemote
  };
})();
