// lib/dates.js —— 日期字符串工具
//
// 全链路只认 YYYY-MM-DD（硬约束 3），所以校验和比较都写在这一层。
// handler 校验查询参数用它，validators/ 校验请求体也用它。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 既要格式对，也要是真实存在的日期（挡住 2026-02-30 这种）
function isDateStr(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// 两个日期字符串之间差多少天（都按 UTC 零点算，不会有夏令时误差）
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

// 「服务器当天」的日期字符串，按 GMT+8 算（A3 首次创建设置时取它当 startDate）。
//
// 为什么不直接 new Date().toISOString().slice(0, 10)：那是 **UTC** 日期。
// 东八区凌晨 0 点到 8 点之间，UTC 日期还停在昨天，"今天"就算错了一整天 ——
// 打卡类应用最致命的那类错位（硬约束 3）。本项目口径统一为北京时间。
function todayStr(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { DATE_RE, isDateStr, daysBetween, todayStr };
