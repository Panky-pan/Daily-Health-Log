// repositories/settings.repository.js —— 表 settings 的全部数据库操作
//
// 表 settings 物理上只可能有一行（UNIQUE(user_id) 锁死，见 db/schema.sql），
// 所以这里只有「读那一条」一个操作，不需要列表、不需要分页。
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

module.exports = { getSettings };
