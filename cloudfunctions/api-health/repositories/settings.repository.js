// repositories/settings.repository.js —— 表 settings 的全部数据库操作
//
// 表 settings 物理上只可能有一行（UNIQUE(user_id) 锁死，见 db/schema.sql），
// 所以这里只有「读那一条」和「写那一条」两个操作，不需要列表、不需要分页。
//
// 对外约定与 checkins.repository.js 一致：不抛异常，返回 { row, error }。

const { getDb } = require("../lib/db");
const { USER_ID } = require("../lib/config");

const TABLE = "settings";

// A2 · 读目标设置（契约 4.3）
//
// @returns {Promise<{row: Object|null, error: *}>} 还没设置过时 row = null（不是错误）
async function getSettings() {
  const { data, error } = await getDb()
    .from(TABLE)
    .select("*")
    .eq("user_id", USER_ID)
    .limit(1);
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A3 保存 / 改目标（契约 4.4）：INSERT ... ON CONFLICT (user_id) DO UPDATE
//
// **start_date 必须每次都带上**（2026-10-06 实测踩坑）：
//   最初以为「不把它放进列清单 = 覆盖时不动它」，实测直接 500 DB_ERROR。
//   原因：start_date 是 NOT NULL 且**没有默认值**的列，而 PG 的 ON CONFLICT
//   是先构造 INSERT tuple、再判冲突 —— NOT NULL 检查发生在冲突判定之前，
//   所以"不出现"不是"不改"，而是"插不进去"。
//   （A6 的 saveCheckin 没踩到这个坑：checkins 的 NOT NULL 列 user_id / date
//     本来就在 values 里，其余业务列都可空。）
//   「startDate 永不覆盖」因此改由 handler 保证：已存在时它把库里的原值原样传回来，
//   值没变，坚持率分母就不受影响（契约 3.3 规则 2 的外部行为完全一致）。
//
// 冲突键是 (user_id)：settings 只有一条，user_id 是它的唯一键。
//
// @param {Object} values  已校验过的字段（键即数据库列名）
// @param {string} startDate  YYYY-MM-DD，必填 —— 已存在时由 handler 回填原值
// @returns {Promise<{row: Object|null, error: *}>} row = 写库直接回传的那行
async function saveSettings(values, startDate) {
  // 防御：这一列 NOT NULL 无默认值，缺了必然写不进去。与其让 PG 抛一个费解的
  // not-null violation，不如在日志里把话说清楚（这是 2026-10-06 那个 500 的教训）。
  if (!startDate) {
    return { row: null, error: new Error("saveSettings 缺 start_date（该列 NOT NULL 且无默认值，必须由 handler 传入）") };
  }

  const row = {
    ...values,
    user_id: USER_ID,
    start_date: startDate,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await getDb()
    .from(TABLE)
    .upsert(row, { onConflict: "user_id" })
    .select();
  if (error) return { row: null, error };

  const saved = Array.isArray(data) ? data[0] : data;
  return { row: saved || null, error: null };
}

module.exports = { getSettings, saveSettings };
