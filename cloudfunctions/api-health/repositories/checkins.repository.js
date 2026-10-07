// repositories/checkins.repository.js —— 表 checkins 的全部数据库操作
//
// 分层规则（本项目约定）：
//   凡是 .from("checkins") 开头的查询，只准出现在这个文件里。
//   handler 想要数据就调这里，不许自己拼 SQL。
//
// 对外约定：**不抛异常**，一律返回 { 数据, error }。
//   error 非空 = 这次访问数据库失败，由 handler 决定回什么错；
//   查询「没找到」不是 error，返回 null / 空数组 / false。
//
// 字段与行为依据：api-contract.md 4.5（A4 列表）、4.7（A6 保存）。

const { getDb } = require("../lib/db");
const { USER_ID } = require("../lib/config");

const TABLE = "checkins";

// A4 · 列表读取（契约 4.5）
//
// @param {{from?: string|null, to?: string|null, limit?: number|null}} options
// @returns {Promise<{rows: Object[], error: *}>}
//   rows 永远是**升序**（从早到晚），出错时是空数组。
async function findAll({ from = null, to = null, limit = null } = {}) {
  // 参数化：日期和条数都是作为「结构化参数」传给 SDK 的，不会被拼进查询语句，
  // 所以 from / to / limit 里塞什么都改不了查询本身（这就是防注入）。
  let query = getDb().from(TABLE).select("*").eq("user_id", USER_ID);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  // 带 limit 时先倒序取「最新 N 条」，下面再翻回升序 —— 这样 ?limit=30 才等于直觉里的「最近 30 天」。
  // 不带 limit 直接升序（趋势图按顺序连线，契约 4.5 的硬约定）。
  let ordered = query.order("date", { ascending: limit === null });
  if (limit !== null) ordered = ordered.limit(limit);

  const { data, error } = await ordered;
  if (error) return { rows: [], error };

  const rows = Array.isArray(data) ? data.slice() : [];
  // 翻回升序，保证对外 rows 永远从早到晚
  if (limit !== null) rows.reverse();
  return { rows, error: null };
}

// A6 回读 / 单日读取（契约 4.5 的按日期取一条，也是写库后回读的兜底）
//
// @returns {Promise<{row: Object|null, error: *}>} 那天没记录时 row = null
async function findByDate(date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .select("*")
    .eq("user_id", USER_ID)
    .eq("date", date)
    .limit(1);
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A6 查重：这天有没有记录（只取 date 一列，够判断就行）
// 用途：决定响应里的 isNew（新建 true / 覆盖 false），契约 4.7 的成功响应要它。
//
// @returns {Promise<{exists: boolean, error: *}>}
async function existsByDate(date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .select("date")
    .eq("user_id", USER_ID)
    .eq("date", date)
    .limit(1);
  if (error) return { exists: false, error };

  return { exists: Array.isArray(data) ? data.length > 0 : Boolean(data), error: null };
}

// A6 保存（契约 4.7）：INSERT ... ON CONFLICT (user_id, date) DO UPDATE，
// 一条语句搞定新建和覆盖，也就是 upsert。
//
// 冲突键必须写 (user_id, date)，并且 user_id 必须是 0 而不是 NULL ——
// PG 里 NULL 互不相等，冲突不会发生，同一天会插出第二条记录（契约 4.7 实现要点）。
// updated_at 在这里显式给值（故意的，不用触发器：规则留在代码里一眼能看见）；
// created_at 不在 SQL 里出现，所以覆盖时它保持首次保存的时间。
//
// @param {Object} values 已校验过的字段（键即数据库列名，未填的为 null）
// @param {string} date   YYYY-MM-DD
// @returns {Promise<{row: Object|null, error: *}>} row = 写库直接回传的那行，可能为 null
async function saveCheckin(values, date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .upsert(
      { ...values, user_id: USER_ID, date, updated_at: new Date().toISOString() },
      { onConflict: "user_id,date" }
    )
    .select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A8 局部修改（契约 4.9）：只 UPDATE 请求体里出现的列，没出现的字段保持原值。
//   与 saveCheckin 的 upsert 完全不同 —— upsert 是「同一天没有就插、有就整条覆盖」，
//   patch 是「那天必须有记录、只改这几个字段」。
//
// 不在 values 里放 user_id / date —— 它们是定位键，永远不动。
// updated_at 显式刷新（与 saveCheckin 同款：用代码不用触发器，规则一眼能看见）。
// created_at 不在 UPDATE 范围里，自然保持首次保存的时间。
//
// @param {Object} values 已校验过的字段（键即数据库列名，只包含要改的列）
// @param {string} date   YYYY-MM-DD
// @returns {Promise<{row: Object|null, error: *}>} row = 写库直接回传的那行，可能为 null
async function patchCheckin(values, date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("user_id", USER_ID)
    .eq("date", date)
    .select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A9 删除单日记录（契约 4.10）：DELETE FROM checkins WHERE user_id=0 AND date=...
//   handler 已先查 existsByDate，到这一步一定是「有记录可删」，
//   但 SDK 返回值仍可能为空（比如并发删了），交给 handler 判断。
//
// @returns {Promise<{row: Object|null, error: *}>} row = 被删的那行（带 select() 回传），可能为 null
async function deleteByDate(date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .delete()
    .eq("user_id", USER_ID)
    .eq("date", date)
    .select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

module.exports = { findAll, findByDate, existsByDate, saveCheckin, patchCheckin, deleteByDate };
