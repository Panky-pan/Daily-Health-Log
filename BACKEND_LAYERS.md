# 后端分层结构（BACKEND_LAYERS.md）

记录云函数 `api-health` 的目录分层。**2026-10-05 重构后生效**：只调结构，不改行为 ——
接口、状态码、响应形状、错误文案全部与重构前逐字一致（29 条回归请求比对通过）。
**2026-10-06 补记**：A5、A3 两个接口在这套分层上各自加了一个 handler 函数与一个校验文件，
没有破坏任何一条依赖方向；目录树与行数已按最新代码更新。

## 一、目录树

```
cloudfunctions/api-health/
├── index.js          # 入口（129 行）：进程兜底 + HTTP 服务 + 路由表 + try/catch 兜底
├── scf_bootstrap     # 平台启动脚本（指向 index.js，未改动）
├── package.json      # 未改动（main 仍为 index.js）
├── lib/              # 基础设施层：不认识业务，只提供能力
│   ├── config.js     #   ENV_ID / USER_ID / 一次最多 400 天 / limit 上限 1000 / 请求体上限 64KB / ALLOWED_ORIGINS
│   ├── errors.js     #   错误码字典 ERR（响应层与校验层共用）
│   ├── db.js         #   getDb() 懒加载，全项目**唯一**创建数据库连接的地方
│   ├── response.js   #   CORS 头 + sendJson/sendOk/sendFail/sendDbError/sendMethodNotAllowed
│   ├── mappers.js    #   数据库 snake_case + NULL → API camelCase + ""
│   ├── dates.js      #   isDateStr / daysBetween / todayStr（GMT+8 的"服务器当天"）
│   └── body.js       #   readJsonBody（把请求流读成 JSON 对象）
├── repositories/     # 数据访问层：**唯一的数据库查询出口**，文件名 = 表名
│   ├── checkins.repository.js   # findAll / findByDate / existsByDate / saveCheckin
│   └── settings.repository.js   # getSettings / saveSettings（A3 的 upsert，冲突键 user_id）
├── validators/       # 校验层：只管「值合不合格」，不碰 HTTP、不碰数据库
│   ├── checkin.validator.js     # validateCheckin + 枚举 + 与前端 validate.js 同源的文案
│   └── settings.validator.js    # validateSettings（A3：两个目标值必填 + startDate 可选）
└── handlers/         # 业务层：接请求 → 调函数 → 返响应，一个接口一个函数
    ├── health.js     # A1 GET /api/health
    ├── settings.js   # A2 GET /api/settings、A3 PUT /api/settings
    └── checkins.js   # A4 GET /api/checkins、A5 GET /api/checkins/{date}、A6 PUT /api/checkins/{date}
```

## 二、依赖方向（单向，不许反向引用）

```
index.js ──▶ handlers/ ──▶ repositories/ ──▶ lib/db.js ──▶ CloudBase PG 网关
                   ├────▶ validators/ ──▶ lib/errors.js
                   └────▶ lib/（response、mappers、dates、body、config）
```

- `lib/` 谁都不依赖，可以被任何一层用；
- `repositories/` 只依赖 `lib/`；
- `validators/` 只依赖 `lib/`；
- `handlers/` 依赖上面三者；
- `index.js` 只依赖 `handlers/` 和 `lib/`（response、errors）。

判断改动有没有破坏分层：**在项目里搜 `.from("`，命中必须全部落在 `repositories/`**。

## 三、一个写请求的完整路径（A6）

1. `index.js` 从路径匹配到 `/api/checkins/{date}` → 调 `handlers/checkins.js` 的 `handlePutCheckin`
2. handler 读请求体（`lib/body.js`）、验路径日期（`lib/dates.js`）
3. `validators/checkin.validator.js` 校验 11 个字段，不合格直接回 400
4. `repositories/checkins.repository.js`：`existsByDate()` 判 `isNew` → `saveCheckin()` 走 upsert
5. `lib/mappers.checkinToApi()` 转字段 → `lib/response.sendOk()` 输出

入口文件只出现在第 1 步和最后一步，中间全是函数调用。

## 四、repository 的统一契约

- **不抛异常**，一律返回 `{ rows | row | exists, error }`；
- `error` 非空 = 这次访问数据库失败，由 handler 决定回什么错（都走 `sendDbError`，日志带 `where` 路标）；
- 「没找到」**不是** error：列表回 `[]`、单条回 `null`、存在性回 `false`；
- 排序、条数这些数据层的规矩（如 A4 的「先取最近 N 条再翻回升序」）留在仓库层，handler 拿到的永远是升序。

## 五、以后加接口的落点

| 接口 | 要改哪里 | 要不要动 lib/ |
|---|---|---|
| ~~A5 GET /api/checkins/{date}~~ **✅ 已完成 2026-10-06** | 仓库层 `findByDate` 已有 → 只加了 `handleGetCheckin` + `index.js` 放开 GET | 不用 |
| ~~A3 PUT /api/settings~~ **✅ 已完成 2026-10-06** | `settings.repository.js` 加 `saveSettings` + `handlers/settings.js` 加 `handlePutSettings` + `index.js` 放开 PUT；另新建 `validators/settings.validator.js` | 用了 `lib/dates.js` 的 `todayStr`（新增函数，别的层不受影响） |
| A7 POST /api/checkins/import | 新建 `handlers/import.js` + 在 `checkins.repository.js` 加批量写 | 不用 |

> A5 落地后的实测收获：写「读单日」时**没有新写查询代码**，直接复用了 A6 回读用的 `findByDate` ——
> 这就是仓库层存在的意义（第二节的依赖方向保证 handler 拿到的永远是升序单行）。

## 六、背景

- 重构前：`index.js` 单文件 591 行，数据库查询散在 4 个 handler 里（5 处 `.from(`）。
- 重构后：`index.js` 99 行，5 处查询全部收进 `repositories/`，行为与响应形状不变。
- 回归方式：重构前把 29 个请求（17 读 + 12 写）的响应存盘做基线，部署后重跑同一批请求做逐字 diff，
  只归一化必然变化的字段（A1 的 `time`、响应头 `date`/`last-modified`/`x-cloudbase-*`/`x-request-id`）。
