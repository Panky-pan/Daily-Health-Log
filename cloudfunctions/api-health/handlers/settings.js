// handlers/settings.js —— A2 · GET /api/settings
//
// 接请求 → 调 repository → 返响应，三件事，没别的。

const { sendOk, sendDbError } = require("../lib/response");
const { settingsToApi } = require("../lib/mappers");
const settingsRepo = require("../repositories/settings.repository");

async function handleGetSettings(res) {
  const { row, error } = await settingsRepo.getSettings();

  if (error) return sendDbError(res, "GET /api/settings", error);

  // 还没设置过 → 200 + settings: null（不是 404，契约 4.3）
  return sendOk(res, { settings: row ? settingsToApi(row) : null });
}

module.exports = { handleGetSettings };
