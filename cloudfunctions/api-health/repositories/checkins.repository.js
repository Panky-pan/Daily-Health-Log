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
//
// ⚠️ 软删除铁律（2026-10-07 加，契约 4.11）：
//   本表所有「读」「改」都必须跳过 is_deleted = true 的行，否则被删的记录会复活。
//   为了不漏，**一律走下面的 visibleOnly()**，不要在各查询里手写 .eq("is_deleted", false)——
//   手写会漏，漏了不报错，只是数据莫名其妙「回来了」，是最难查的那类 bug。
//   唯一**故意**不过滤的两处：softDeleteByDate / restoreByDate（它们要操作的就是已删行）。

const { getDb } = require("../lib/db");
const { USER_ID } = require("../lib/config");

const TABLE = "checkins";

// ---------------------------------------------------------------------------
// 软删除统一过滤：任何「正常业务」查询都从这里过一道
// ---------------------------------------------------------------------------
// 用法：visibleOnly(getDb().from(TABLE).select("*")) —— 在任何 .eq() 之前套上即可。
// 为什么写成函数而不是常量 `.eq("is_deleted", false)` 直接贴在每处：
//   ① 新增查询时照抄第一句就有过滤，想漏也难；
//   ② 将来若要改成「按时间窗可见」之类的语义，只改这一个地方。
function visibleOnly(query) {
  return query.eq("is_deleted", false);
}

// A4 · 列表读取（契约 4.5）
//
// @param {{from?: string|null, to?: string|null, limit?: number|null}} options
// @returns {Promise<{rows: Object[], error: *}>}
//   rows 永远是**升序**（从早到晚），出错时是空数组。
async function findAll({ from = null, to = null, limit = null } = {}) {
  // 参数化：日期和条数都是作为「结构化参数」传给 SDK 的，不会被拼进查询语句，
  // 所以 from / to / limit 里塞什么都改不了查询本身（这就是防注入）。
  let query = visibleOnly(getDb().from(TABLE).select("*").eq("user_id", USER_ID));
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
// 软删除后：已经软删的那天，这里查不到（走 visibleOnly 过滤），
//   对调用方就是「那天没记录」—— 于是 A5 自动返回 record:null，不用在 handler 里特殊处理。
//
// @returns {Promise<{row: Object|null, error: *}>} 那天没记录（或已删除）时 row = null
async function findByDate(date) {
  const { data, error } = await visibleOnly(
    getDb().from(TABLE).select("*").eq("user_id", USER_ID).eq("date", date)
  ).limit(1);
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A6 查重 / A8·A9 的存在性判断：这天有没有「可见的」记录（只取 date 一列，够判断就行）
// 用途：决定响应里的 isNew（新建 true / 覆盖 false）；A8/A9 用它判断「目标存不存在」。
//
// 软删除后：已软删的那天这里 exists = false —— 于是：
//   A6 PUT 会把它当新记录写入（触发 upsert，见 saveCheckin 的复活逻辑）；
//   A8 PATCH 会回 404「那天没有打卡记录」；
//   A9 DELETE 会回 404「删不了」（重复删同一天就是这个结果）。
//
// @returns {Promise<{exists: boolean, error: *}>}
async function existsByDate(date) {
  const { data, error } = await visibleOnly(
    getDb().from(TABLE).select("date").eq("user_id", USER_ID).eq("date", date)
  ).limit(1);
  if (error) return { exists: false, error };

  return { exists: Array.isArray(data) ? data.length > 0 : Boolean(data), error: null };
}

// A6 保存（契约 4.7）：**显式二段式 upsert** —— 先查可见行，有则按 id 整条覆盖，
// 无则新插一行。对外行为与旧 upsert 完全一致，实现不再依赖 ON CONFLICT。
//
// ⚠️ 为什么弃用 .upsert(..., { onConflict: "user_id,date" })（2026-10-09 真机定位）：
//   软删除把唯一约束换成了部分唯一索引（WHERE NOT is_deleted）后，
//   ON CONFLICT (user_id, date) 必须带上谓词才匹配得到它，而谓词靠 PostgREST
//   从请求体里的 is_deleted: false 推断（predicate inference）。
//   实测推断在当前网关上**不生效**——单对象、[row] 包数组两种写法全都报：
//       DATABASE_42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
//   线上佐证：request_id dc730d01-d21c-4a01-84a6-974b394e57e6（2026-10-09 10:49 日志，
//   当时部署的已是 [row] + is_deleted: false 的写法）。
//   这个推断依赖底层 SDK 与网关 PostgREST 的版本行为，太脆。
//   二段式只依赖最普通的 UPDATE / INSERT，行为完全可控，也不再关心
//   「SDK 什么时候设 ?columns=」这类内部细节。
//
// 语义逐条对齐旧 upsert：
//   那天有可见记录 → 按 id 整条覆盖（SET 里不含 created_at，首次保存时间不变）；
//   那天没有可见记录（从未写过 / 已被软删）→ INSERT 新行；
//     已软删的旧行原样留在库里（保留历史），读取侧 visibleOnly 只看得到新行
//     —— 这就是契约 4.7 的「重新打卡复活」。
//
// 并发兜底（对应测试清单的"快速连点"用例）：两个请求同时走 INSERT，
//   后到的会撞部分唯一索引（23505）。撞上时不直接报错：重查一次，
//   可见行出现了就转覆盖分支重试，仍失败才把错误交回 handler。
//
// updated_at 在这里显式给值（故意的，不用触发器：规则留在代码里一眼能看见）。
//
// @param {Object} values 已校验过的字段（键即数据库列名，未填的为 null）
// @param {string} date   YYYY-MM-DD
// @returns {Promise<{row: Object|null, error: *}>} row = 写库直接回传的那行，可能为 null
async function saveCheckin(values, date) {
  const { row: existing, error: findError } = await findByDate(date);
  if (findError) return { row: null, error: findError };

  // 分支一：有可见记录 → 按 id 整条覆盖（user_id / date 是定位键，不动）
  if (existing) {
    const { data, error } = await getDb()
      .from(TABLE)
      .update({ ...values, is_deleted: false, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("user_id", USER_ID)
      .select();
    if (error) return { row: null, error };
    const row = Array.isArray(data) ? data[0] : data;
    return { row: row || null, error: null };
  }

  // 分支二：没有可见记录 → 新插一行（含「软删后重新打卡」的复活场景）
  const insertOnce = () =>
    getDb()
      .from(TABLE)
      .insert([
        { ...values, user_id: USER_ID, date, is_deleted: false, updated_at: new Date().toISOString() },
      ])
      .select();

  let { data, error } = await insertOnce();

  // 并发兜底：另一路请求抢先插了同一天的可见行（23505）→ 重查，改走覆盖
  if (error) {
    const again = await findByDate(date);
    if (again.error) return { row: null, error };
    if (again.row) {
      const { data: updated, error: updateError } = await getDb()
        .from(TABLE)
        .update({ ...values, is_deleted: false, updated_at: new Date().toISOString() })
        .eq("id", again.row.id)
        .eq("user_id", USER_ID)
        .select();
      if (updateError) return { row: null, error: updateError };
      const row = Array.isArray(updated) ? updated[0] : updated;
      return { row: row || null, error: null };
    }
    return { row: null, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A8 局部修改（契约 4.9）：只 UPDATE 请求体里出现的列，没出现的字段保持原值。
//   与 saveCheckin 的 upsert 完全不同 —— upsert 是「同一天没有就插、有就整条覆盖」，
//   patch 是「那天必须有记录、只改这几个字段」。
//
// 软删除后：**必须加 visibleOnly**，否则会把一个「用户已经删掉、界面上看不见」的
//   记录悄悄改掉 —— 那种 bug 不会报错，只在某天恢复时冒出来，很难查。
//
// 不在 values 里放 user_id / date —— 它们是定位键，永远不动。
// updated_at 显式刷新（与 saveCheckin 同款：用代码不用触发器，规则一眼能看见）。
// created_at 不在 UPDATE 范围里，自然保持首次保存的时间。
//
// @param {Object} values 已校验过的字段（键即数据库列名，只包含要改的列）
// @param {string} date   YYYY-MM-DD
// @returns {Promise<{row: Object|null, error: *}>} row = 写库直接回传的那行，可能为 null
async function patchCheckin(values, date) {
  const { data, error } = await visibleOnly(
    getDb()
      .from(TABLE)
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("user_id", USER_ID)
      .eq("date", date)
  ).select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A9 软删除单日记录（契约 4.10）：UPDATE ... SET is_deleted = TRUE WHERE user_id=0 AND date=...
//
// **数据不真删**：行还在表里（created_at 等历史都在），只是被标记为「看不见」。
// 读取侧靠 visibleOnly 过滤，所以对业务而言和真删一模一样。
//
// 为什么不再用 .delete()：删错了找不回来。软删后可以用 restoreByDate 恢复
// （契约 4.11 的 A10），前端也就不需要再强调「不可恢复」。
//
// 这里**故意不加** visibleOnly —— 要更新的正是「当前可见的那一行」，
//   加了过滤反而改不到。用 existsByDate 在 handler 层保证它确实可见。
//
// @returns {Promise<{row: Object|null, error: *}>} row = 被标记的那行（带 select() 回传），可能为 null
async function softDeleteByDate(date) {
  const { data, error } = await getDb()
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq("user_id", USER_ID)
    .eq("date", date)
    .eq("is_deleted", false)   // 只标记「目前可见」的那行，避免重复标记
    .select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

// A10 恢复单日记录（契约 4.11）：把 is_deleted 标记清掉，让那天重新可见。
//
// 这里**故意不加** visibleOnly（和 softDeleteByDate 同理）—— 要操作的就是已删行。
// 为什么不 filter 日期唯一：被软删的那天通常只有一行已删记录，
//   但「软删 → 重新打卡 → 又软删」会产生多行已删记录。此时恢复全都清掉，
//   会撞上部分唯一索引（同一天两条 is_deleted=false）。所以只恢复**最近标记的那一行**
//   （按 updated_at 倒序取第一条），语义明确：撤销最近一次删除。
//
// @returns {Promise<{row: Object|null, error: *}>} row = 恢复后的那行；那天没有被删的记录时 row = null
async function restoreByDate(date) {
  // 先找出最近被标记删除的那一行（可能有多个历史已删行）
  const { data: found, error: findError } = await getDb()
    .from(TABLE)
    .select("id")
    .eq("user_id", USER_ID)
    .eq("date", date)
    .eq("is_deleted", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (findError) return { row: null, error: findError };

  const target = Array.isArray(found) ? found[0] : found;
  if (!target) return { row: null, error: null };   // 那天没有被删的记录，交给 handler 判 404

  const { data, error } = await getDb()
    .from(TABLE)
    .update({ is_deleted: false, updated_at: new Date().toISOString() })
    .eq("user_id", USER_ID)
    .eq("id", target.id)
    .select();
  if (error) return { row: null, error };

  const row = Array.isArray(data) ? data[0] : data;
  return { row: row || null, error: null };
}

module.exports = {
  findAll,
  findByDate,
  existsByDate,
  saveCheckin,
  patchCheckin,
  softDeleteByDate,
  restoreByDate,
};
