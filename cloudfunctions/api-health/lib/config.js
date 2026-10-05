// lib/config.js —— 全项目唯一的「魔法值」出处
//
// 之前这些常量散在 index.js 里，现在集中到这里：改一处，全项目生效。
// 这一层不认识 HTTP，也不认识数据库，只提供参数。

// 环境 ID 不是密钥（它本来就写在公网地址里），作为兜底默认值；
// 云函数环境里有 TCB_ENV 时优先用环境里的。
const ENV_ID = process.env.TCB_ENV || "daily-health-log-d3eej7197499a30";

// 本期是单人自用，所有行都归属 user_id = 0（见 api-contract.md 3.4）。
// 抽成常量是为了二期接入登录时只改这一处。
const USER_ID = 0;

// A4 的区间保护：一次最多查 400 天（契约 4.5 / TECH_DESIGN B6）
const MAX_RANGE_DAYS = 400;

// A4 的条数上限：limit 参数的取值范围（契约 4.5）
const MAX_LIMIT = 1000;

// A6 的请求体上限：单日记录再长也就几百字节，64KB 是个宽松的上限，
// 超过就直接拒绝，不给内存压力。
const MAX_BODY_BYTES = 64 * 1024;

module.exports = {
  ENV_ID,
  USER_ID,
  MAX_RANGE_DAYS,
  MAX_LIMIT,
  MAX_BODY_BYTES,
};
