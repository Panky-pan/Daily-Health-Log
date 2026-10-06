// lib/errors.js —— 错误码字典
//
// 前端按 code 分支判断，message 是给人看的中文口语短句（契约 2.2 / 2.3）。
// 单独放一份的原因：响应层（lib/response.js）和校验层（validators/）都要用它，
// 放响应层会让校验层反向依赖「怎么写 HTTP 响应」，属于层次倒挂。

const ERR = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_PARAM: "INVALID_PARAM",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  DB_ERROR: "DB_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

module.exports = { ERR };
