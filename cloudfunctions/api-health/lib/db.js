// lib/db.js —— 数据库客户端的唯一出处
//
// 只干一件事：把「怎么连数据库」这件事收拢到一个函数里。
// repositories/ 里的每个查询都从这里拿客户端，别的地方不许自己 new 一个连接。

const { ENV_ID } = require("./config");

// 为什么懒加载：/api/health 不碰数据库，就算凭证还没配好也该能探活。
let _db = null;

function getDb() {
  if (_db) return _db;
  // 服务端 SDK；数据库访问走 CloudBase PG 网关（免 VPC、免数据库密码）。
  // 凭证从云函数环境变量 CLOUDBASE_APIKEY 自动读取，绝不写进代码。
  const tcb = require("@cloudbase/node-sdk");
  const app = tcb.init({ env: ENV_ID });
  // 必须显式指定 database: "public"！
  // SDK 内部是 `const { database = envId } = options`（见 node-sdk dist/cloudbase.js）——
  // 不传时它会把「环境 ID」当成 schema 名塞进 Accept-Profile / Content-Profile 头，
  // 网关就回 406 DATABASE_PGRST106「Invalid schema: <环境ID>」。
  // 实测（2026-10-02）：加上这一项，读表立刻成功。
  _db = app.rdb({ instance: "default", database: "public" });
  return _db;
}

module.exports = { getDb };
