# API 契约 ·「每日健康打卡」(Daily-Health-Log)

> 版本：v1.9　登记日期：2026-10-01　最近更新：2026-10-08
> 依据文档：PRD.md v1.2、TECH_DESIGN.md v1.4、第 2 周前端成品（welcome / index / checkin / history / trends 五页 + assets 全套 JS）
> 读者：零基础开发者（Panky）本人，以及未来任何想接手这个项目的人
>
> **本文件的状态：读接口 + 写接口（A6 PUT 全量覆盖 / A8 PATCH 局部修改 / A9 DELETE 软删除单日 / A10 POST 恢复被删单日）已实现。**
> 它是第 3 周建表、写接口的**唯一依据**；代码与本文档冲突时，以本文档为准；要改接口先改这里。
> 进度（2026-10-08）：**A1 `GET /api/health`、A2 `GET /api/settings`、A3 `PUT /api/settings`、A4 `GET /api/checkins`、A5 `GET /api/checkins/{date}`、A6 `PUT /api/checkins/{date}`、A8 `PATCH /api/checkins/{date}`、A9 `DELETE /api/checkins/{date}`、A10 `POST /api/checkins/{date}/restore` 已上线**（实现细节见 4.11）；两张表已建成（见 3.4）；**10 个接口里 9 个已实现**，只剩 A7 `POST /api/checkins/import`（迁移专用，可延后）。

---

## 〇、30 秒读懂这份文件

**它是什么**：前端和后端之间的「对话说明书」。前端照它发请求，后端照它回数据——两边不用互相等，各自照单开发。

**它不是什么**：
- 不是数据库设计文档的替代品（建表 SQL 已成文件放在 `db/schema.sql`，本文档只写"接口看得见的数据形状"，实现现状另在 3.4 登记）；
- 不是第 3 周的实现计划（施工顺序在 TECH_DESIGN 3.0）；
- 不含鉴权细节（本期无账号，鉴权细则等二期登录一起定）。

**今天为什么必须写它**：第 3 周要建表、写接口，如果接口形状等到写代码时才边写边定，前端一定会返工。先把"路径 + 参数 + 返回什么"钉死，第 3 周就是填空。

---

## 一、三条硬约束（Web 端与未来手机 APP 共用）

> 背景：这个项目最终要做成跨端 APP（Flutter，见项目备忘的远期方向），手机端也要用同一套后端。

| # | 约束 | 为什么 |
|---|---|---|
| 1 | 接口一律是**纯 HTTP REST + JSON**，前端不依赖任何 CloudBase 专用 SDK | 网页版和 Flutter APP 都能用同一套接口；若网页走 CloudBase Web SDK 直连数据库，APP 端没法复用，等于后端白写一遍 |
| 2 | **字段命名永久稳定**（camelCase，沿用 TECH_DESIGN 2.2）；后端数据库列名 snake_case，转换在云函数里做 | APP 按同一份 JSON 解析，改字段名 = 客户端必须跟着发版，代价极高 |
| 3 | `date` 全链路是 `YYYY-MM-DD` **本地日期字符串**，禁止转成时间戳或 UTC | GMT+8 的"今天"一换算就会错位成"昨天"，打卡类应用的致命 bug（TECH_DESIGN 3.7 第 6 条） |

---

## 二、通用约定

### 2.1 基地址（Base URL）

| 项 | 值 | 说明 |
|---|---|---|
| 云函数 HTTP 访问地址 | `https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com` | 2026-10-01 开通；2026-10-02 起网关路由放宽为 **`/api`（前缀匹配 + 路径透传）**，所有 `/api/...` 都由同一个云函数 `api-health` 处理 |
| 本文件中的写法 | `<API_BASE>/api/...` | 路径一律以 `/api` 开头 |

新增接口**不用再动网关**：网关只保留一条 `/api` 前缀路由，新接口在云函数里加一条路径分支即可（TECH_DESIGN 3.3 的"单入口"结论，2026-10-02 已按此实现）。

### 2.2 响应形状（成功 / 失败两种）

**成功**：

```json
{ "ok": true, "data": { } }
```

**失败**：

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "体重需在 30~200 kg 之间", "field": "weightKg" } }
```

- `error.code` 是给程序看的（前端据此分支），`error.message` 是给人看的（可直接展示给用户，中文口语短句）。
- `error.field` 只在字段级校验错误时出现，前端拿它定位到具体输入框旁显示红字（对应 TECH_DESIGN 3.4 第 6 步）。
- 顶层永远有 `ok` 布尔值，前端可以先用它做粗判断。

> **唯一例外**：`GET /api/health` 的返回形状由当天任务清单直接指定，不带 `data` 包裹（见 4.1）。它是已上线的既成事实，第 3 周不为统一而改它。

### 2.3 HTTP 状态码与错误码对照表

| HTTP | code | 什么时候出现 | 前端应该怎么处理 |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | 字段值不合法（体重 500、时长 -5 等），带 `field` | 在该输入框旁显示红字，不保存（PRD E5/B2） |
| 400 | `INVALID_PARAM` | 路径/查询参数本身格式错（日期不是 `YYYY-MM-DD`、`from` 晚于 `to`、区间超 400 天） | 通用提示「请求参数不对」，属开发期错误，正常用户碰不到 |
| 401 | `UNAUTHORIZED` | 未登录或登录失效（二期启用，本期不出现） | 清本地登录态 → 跳登录页（TECH_DESIGN 3.4） |
| 403 | `FORBIDDEN` | 请求带了 Origin 且不在白名单（2026-10-06 起，见 2.7） | 正常用户碰不到；只有别的网站想跨域调接口才会出现 |
| 404 | `NOT_FOUND` | 请求的**路径**不存在 | 开发期错误提示 |
| 405 | `METHOD_NOT_ALLOWED` | 路径对但方法不对（如对 `/api/checkins/2026-10-01` 发 POST） | 开发期错误提示 |
| 500 | `DB_ERROR` | 数据库连接失败、查询报错 | 「记录暂时取不出来，稍后再试」+ 重试按钮（对齐四态里的失败态） |
| 500 | `INTERNAL_ERROR` | 云函数未捕获异常 | 同上；堆栈只进云端日志，不回给前端 |

统一由云函数的兜底 try/catch 产出，**任何情况下都返回 JSON**，不返回 HTML 错误页。

### 2.4 字段命名映射（API ↔ 数据库）

| 层 | 风格 | 示例 |
|---|---|---|
| 前端 / API JSON | camelCase | `exerciseMinutes` |
| PostgreSQL 列 | snake_case | `exercise_minutes` |

转换只在云函数里做一次。前端（含未来 APP）永远只看 camelCase。

### 2.5 鉴权

本期（单人自用）**所有接口开放，不要求身份**。
契约统一预留请求头 `Authorization: Bearer <token>`：一期不发不校验，二期登录接入后逐接口启用（TECH_DESIGN 3.0 第 ⑥ 步：公网暴露前必须挂上）。

> **一条顺序约束（2026-10-06 补记，踩过坑才写下）**：本期**前端网页与云函数用的是同一个 `anon` 身份**。所以**不能先收回 `anon` 的写权限**——一收，网页自己点保存就报 `permission denied`（Day 18 就是这么失败过一次：读接口正常、写接口 42501）。正确顺序是：**二期先让网页改用登录身份（`authenticated`），再把 `anon` 降级为只读**。谁想「先把权限收了再说」都会把自己锁在门外。
>
> **本期已知的敞口（不是 bug，是单人自用阶段的取舍）**：任何拿到站点/接口地址的人，不只能**读**到记录，还能**改**、**删**，以及**恢复**被删的记录（`anon` 自 2026-10-07 起 带 `INSERT / UPDATE / DELETE` 三项写权限；A10 恢复走 `UPDATE`，不需要新权限）。2026-10-06 真人跨设备测试当天即被确认——同伴打开链接看到的是本人的三餐与体重，并当场提出疑问。**因此链接不能公开发布**；正式解法是二期接入登录（属已排期的后续任务）。

### 2.6 关于「空值」的约定（重要，防渲染出 "null kg"）

前端第 2 周页面判断空值的写法是 `record.weightKg === ''`（见 `assets/js/history.js` 第 148 行）。

因此契约规定：

- 用户**没填**的字段 → 返回**空字符串 `""`**（不是 `null`，不是 `0`，不是 `undefined`）；
- 数值字段（分钟 / 卡路里 / 体重 / 饮水）→ 有值时返回 **number**，没值时返回 `""`；
- 三餐标签未选 → `""`（枚举值为纯文字「健康 / 普通 / 放纵」，不带图标，PRD 6.4）。

### 2.7 CORS（2026-10-02 实测修正）

原生 APP 没有跨域概念，CORS 只影响浏览器。

**结论：跨域头由 CloudBase HTTP 网关自己回，云函数不要自己写 `Access-Control-Allow-Origin`。**

网关（响应头 `server: tcbgw`）会回 `access-control-allow-credentials: true` 与 `access-control-allow-origin: <请求的 Origin>`；云函数若再写一个 `*`，网关会拼成 `http://xxx,*` 这种非法多值（带 `credentials: true` 时 `Allow-Origin` 不允许是 `*`，更不允许逗号多值），浏览器直接判跨域失败，前端只看到 `Failed to fetch`。

现状：云函数只保留 `Allow-Methods` / `Allow-Headers`，`Allow-Origin` 交给网关；实测四个页面均能正常取数。

**2026-10-06 修正（方案 A，取代上一段"作废"结论）**：网关回显等于「对所有域名开放跨域」，与「接口只服务自己的页面」目标冲突，且响应头层面拦不住（上面实测过）。改为**服务端校验 Origin**：

- 请求带 `Origin` 且不在白名单 → **403 `FORBIDDEN`**，读写接口一律生效，先于路由与 OPTIONS 预检（预检被 403，浏览器就不会再发真请求）；
- 白名单 = 静态托管线上域名 + `localhost` / `127.0.0.1` 任意端口（本地调试，`python -m http.server` / Live Server 端口不固定）+ `null`（本地 `file://` 双击打开 HTML）；
- 不带 `Origin` 的请求（curl / Postman / 服务端脚本）放行——它们不受浏览器同源策略约束，本期单人自用不做更重鉴权（见 2.5）；
- `Access-Control-Allow-Origin` 仍然交给网关回显，云函数自己依旧不写（防拼接非法多值，见上文实测）。
- 白名单出处：云函数 `lib/config.js` 的 `ALLOWED_ORIGINS` + `index.js` 的 `originAllowed()`（本机地址正则单独放行）。

---

## 三、数据表（两张，第 3 周建表依据）

### 3.1 表清单与角色说明

| 表名 | 一句话角色 | 对应课程案例的表 | 建表 SQL 出处 |
|---|---|---|---|
| `checkins` | 每日打卡记录，**一天一条**，覆盖保存 | 案例的 `checkins` | `db/schema.sql`（2026-10-01 已建成） |
| `settings` | 全局目标设置，**只有一条** | 案例的 `plan_days`（"计划/目标"角色） | `db/schema.sql`（2026-10-01 已建成） |

> **命名说明**：这两张表名沿用 TECH_DESIGN 3.2 已定稿的 SQL（也与课程案例的 `checkins` 同名），本期不另起 `daily_records` / `goal_settings` 之类的新名字——同一个项目里同一个东西只允许一个名字。
> 你的环境是 **PostgreSQL 模式**（2026-10-01 实测确认），建表走 PG 路线。

### 3.2 `checkins` 表 · 接口层字段（API JSON camelCase）

单日记录的字段与 PRD 6.1、TECH_DESIGN 2.2 完全一致：

| API 字段 | 类型 | 必填 | 数据库列 | 取值与约束 |
|---|---|---|---|---|
| `date` | string `YYYY-MM-DD` | 是 | `date` | 本地日期；同一用户同一天唯一（`UNIQUE(user_id, date)`） |
| `exerciseType` | string | 否 | `exercise_type` | 枚举：散步 / 慢跑 / 跳绳 / 骑行 / 力量训练 / 瑜伽；没记运动为 `""` |
| `exerciseMinutes` | number \| `""` | 否 | `exercise_minutes` | 0~600 整数（PRD E5） |
| `exerciseCalories` | number \| `""` | 自动 | `exercise_calories` | **由前端 `calories.js` 算出后随请求提交**，用户不可填；后端只做范围校验（0~9999），**不重新计算**（TECH_DESIGN 3.7 第 5 条） |
| `mealBreakfastText` | string | 否 | `meal_breakfast_text` | 一句话，没记为 `""` |
| `mealBreakfastTag` | string | 否 | `meal_breakfast_tag` | `健康` / `普通` / `放纵` / `""` |
| `mealLunchText` | string | 否 | `meal_lunch_text` | 同上 |
| `mealLunchTag` | string | 否 | `meal_lunch_tag` | 同上 |
| `mealDinnerText` | string | 否 | `meal_dinner_text` | 同上 |
| `mealDinnerTag` | string | 否 | `meal_dinner_tag` | 同上 |
| `weightKg` | number \| `""` | 否 | `weight_kg` | 30~200，一位小数（PRD E5） |
| `waterMl` | number \| `""` | 否 | `water_ml` | 0~10000 整数 |

**不落库的派生值**（第 3 周**不要**给它们建列）：
- 饮食健康分（PRD 6.4：每餐 2/1/0，全天 0~6）——展示时按标签实时算；
- streak / 历史最长 / 坚持率 / 周运动汇总 / 今日健康小建议——全部由前端 `stats.js` 算。

### 3.3 `settings` 表 · 接口层字段

| API 字段 | 类型 | 必填 | 数据库列 | 说明 |
|---|---|---|---|---|
| `goalExerciseMinutes` | number | 是 | `goal_exercise_minutes` | 每日运动目标（分钟），1~600 整数 |
| `goalWaterMl` | number | 是 | `goal_water_ml` | 每日饮水目标（ml），1~10000 整数 |
| `startDate` | string `YYYY-MM-DD` | 首次自动 | `start_date` | 坚持率分母的起点（PRD F3）。**写入后永不被覆盖**——改目标不影响坚持率 |

**`startDate` 的写入规则（三条，必须是这个行为）**：

1. 首次创建设置（表里还没有这条记录）时：请求带了 `startDate` 就用它，没带就取**服务器当天日期**；
2. 记录已存在时：`startDate` **原样保留**，请求里带了也不改（含改目标、重复保存）；
3. 前端不必操心这条规则，照常提交两个目标值即可。

> 附带发现（不在今天任务范围内，仅记录）：本地版 `today.js` 保存目标时整体覆盖了 `dhl:settings`，会把 `startDate` 抹掉，靠下次打卡再补写。云端契约用上面第 2 条把它从根上解决了——要不要回头修本地版，你定，今天不动手。

### 3.4 数据库实现现状（2026-10-01 建表落地）

建表脚本已生成，位置：

| 文件 | 作用 |
|---|---|
| `db/schema.sql` | 建 `checkins` / `settings` 两张表（可重复执行） |
| `db/seed.sql` | 1 条设置 + 9 条示例数据（可重复执行） |
| `db/README.md` | 控制台执行步骤 + 5 组验证 SELECT + 报错对照表 |

**实际建成的表与上面 3.2 / 3.3 的差异只有一处，但很关键：**

| 项 | 实际实现 | 为什么这么做 |
|---|---|---|
| `user_id` | `BIGINT NOT NULL DEFAULT 0`，本期恒为 0 | 本期不建 `users` 表。**不能允许 NULL**——PG 里 NULL 互不相等，`UNIQUE (user_id, date)` 对 NULL 完全不生效，同一天能插进多条，A6 的 upsert 会静默写出重复记录 |
| `user_id` 外键 | 本期**不建** | `users` 表属二期，表还不存在，外键加不上 |
| `settings` 的"只有一条" | `UNIQUE (user_id)` + 默认值 0 | 同上的坑；若 user_id 为 NULL，这条唯一约束同样失效 |
| 额外的技术列 | `id`（主键）、`created_at`、`updated_at` | 上面两张表只列了业务字段；这三个不参与接口返回 |

**二期接入登录时的收编动作**（把 TECH_DESIGN 3.7 第 7 条落成具体 SQL）：

```sql
UPDATE checkins SET user_id = <你的 user id> WHERE user_id = 0;
UPDATE settings SET user_id = <你的 user id> WHERE user_id = 0;
ALTER TABLE checkins ADD CONSTRAINT checkins_user_fk FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE settings ADD CONSTRAINT settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id);
```

**约束清单**（与 3.2 / 3.3 的取值范围逐条对应；数据库是校验的最后一道闸）：

| 表 | 约束名 | 内容 |
|---|---|---|
| `checkins` | `checkins_user_date_key` | `UNIQUE (user_id, date)` —— 一天一条，A6 upsert 的前提 |
| `checkins` | 8 个 CHECK | 运动类型 6 值枚举、时长 0~600、卡路里 0~9999、三餐标签枚举、体重 30~200、饮水 0~10000 |
| `settings` | `settings_user_key` | `UNIQUE (user_id)` —— 单人只有一条 |
| `settings` | 2 个 CHECK | 运动目标 1~600、饮水目标 1~10000 |

**空值分工**（对应 2.6）：数据库列存 `NULL`，云函数负责在响应里转成 `""`。**不要往数据库里写空字符串**——数值列是 INTEGER / NUMERIC 类型，本来也存不下。

**`start_date` 永不覆盖**：这是云函数的逻辑，故意**没有写数据库触发器**。触发器会把业务规则藏进数据库、出错时难排查；规则留在写接口的代码里，一眼能看到。

**索引**：只依赖 `UNIQUE (user_id, date)` 自带的索引，不额外建。单人一年 365 行，全表扫描是毫秒级；等数据量真的上来了再按实际慢查询补。

---

## 四、接口清单

### 4.1 总表

| 编号 | 方法 | 路径 | 用途 | 状态 |
|---|---|---|---|---|
| A1 | GET | `/api/health` | 健康检查 | **已上线（2026-10-01）** |
| A2 | GET | `/api/settings` | 读目标设置 | **已实现（2026-10-02）** |
| A3 | PUT | `/api/settings` | 存 / 改目标设置 | **已实现（2026-10-06）** |
| A4 | GET | `/api/checkins` | **列表读取**：按日期区间取打卡记录（不传参＝取全部） | **已实现（2026-10-02）** |
| A5 | GET | `/api/checkins/{date}` | 读单日记录 | **已实现（2026-10-06）** |
| A6 | PUT | `/api/checkins/{date}` | 保存 / 覆盖单日记录（**PUT 全量覆盖**，唯一的 upsert 写入口） | **已实现（2026-10-03）** |
| A7 | POST | `/api/checkins/import` | 批量导入（本地数据迁移专用） | 登记待实现，**可延后** |
| A8 | PATCH | `/api/checkins/{date}` | **局部修改**单日记录（只改请求体里出现的字段，没出现的字段不动） | **已实现（2026-10-07）** |
| A9 | DELETE | `/api/checkins/{date}` | **软删除**单日记录（数据不真删，只打 `is_deleted` 标记，可用 A10 恢复；前端仍必须二次确认） | **已实现（2026-10-07）** |
| A10 | POST | `/api/checkins/{date}/restore` | **恢复**被 A9 软删除的单日记录（清掉 `is_deleted` 标记） | **已实现（2026-10-07）** |

> A2 / A4 / A5 / A6 / A8 / A9 / A10 的实现方式、凭证与踩坑记录见 **4.11**。

> **关于"写入口"的三层分工**：
> - **A6 PUT**：唯一的 **upsert** 写入口（新建 + 整条覆盖）。前端打卡页"保存今日记录"走这个。
> - **A8 PATCH**：**局部修改**已存在的记录（只改请求体里出现的字段，其他字段保持）。前端"只改一个字段"的场景走这个；不存在的日期返 404（不能 PATCH 一条不存在的记录）。
> - **A9 DELETE**：**删掉**单日记录。对调用方表现为"删了就没"，但内部是**软删除**——数据留在库里，可以撤销（见 A10）。不存在的日期返 404。前端仍必须二次确认（页面没有恢复入口）。
> - **A10 POST /{date}/restore**：**撤销 A9 的删除**（软删除的存在意义）。不是写内容、不是幂等创建，所以用 POST 而不是 PUT。那天没有被删的记录返 404。
>
> 本契约**没有**"单条写入的 POST 接口"——POST 只出现在 **A7（批量导入）** 和 **A10（恢复）** 两处，都不是"写单日记录内容"。
> 想用 POST 写单日记录的话，那是另一套设计，得先改契约。
>
> **A9 与 A10 是一对**：A9 打标记（`is_deleted = true`）→ 那天从所有正常查询里消失；A10 清标记 → 那天重新可见。读取侧的过滤铁律见 4.11。

> A4 就是"列表读取接口"这个角色位（对应课程案例的 `GET /api/favorites`）：历史页的筛选列表、日历、趋势图全靠它一次取数。

---

### 4.2 A1 · GET /api/health

**用途**：确认云函数活着、能联通。
**请求参数**：无。
**成功响应**（200，形状由任务清单指定，不带 `data` 包裹）：

```json
{ "ok": true, "service": "daily-health-log-demo", "time": "2026-10-01 20:59:25" }
```

**错误返回**：方法不对 → 405 `{"ok":false,"error":{"code":"METHOD_NOT_ALLOWED","message":"这个地址不支持 POST 请求"}}`
（2026-10-02 已按第七节第 3 项统一成 2.2 的形状；**成功响应仍是本契约唯一的例外**，不带 `data` 包裹。）

> 状态：✅ 已上线（2026-10-01）。验证：浏览器打开 `<API_BASE>/api/health`。

---

### 4.3 A2 · GET /api/settings

**用途**：今日页 / 打卡页读目标（首次使用判断、提醒条阈值、坚持率分母）。
**请求参数**：无。
**成功响应**（200）：

```json
{
  "ok": true,
  "data": {
    "settings": { "goalExerciseMinutes": 30, "goalWaterMl": 2000, "startDate": "2026-09-21" }
  }
}
```

**还没有设置过**（首次使用，对应 PRD F1 / E1）：仍是 200，`settings` 为 `null`——

```json
{ "ok": true, "data": { "settings": null } }
```

> 为什么不返回 404：前端需要区分"没设置过"（显示设置表单）和"请求出错"（显示错误态）。用 200 + null 表达"没有"，前端一个判断就够，不必把正常业务状态塞进错误分支。

**错误返回**：500 `DB_ERROR` / `INTERNAL_ERROR`。

> 状态：✅ 已实现（2026-10-02）。验证：浏览器打开 `<API_BASE>/api/settings`，当前返回 `30 / 2000 / 2026-09-21`。

---

### 4.4 A3 · PUT /api/settings

**用途**：首次设置目标、之后修改目标（PRD F1）。
**请求头**：`Content-Type: application/json`
**请求体**：

```json
{ "goalExerciseMinutes": 30, "goalWaterMl": 2000 }
```

| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| `goalExerciseMinutes` | number | 是 | 1~600 的整数 |
| `goalWaterMl` | number | 是 | 1~10000 的整数 |
| `startDate` | string | 否 | `YYYY-MM-DD`；仅首次创建时生效（见 3.3 规则） |

**成功响应**（200）：返回保存后的完整设置，前端可直接用它刷新界面。

```json
{
  "ok": true,
  "data": {
    "settings": { "goalExerciseMinutes": 30, "goalWaterMl": 2000, "startDate": "2026-09-21" }
  }
}
```

**错误返回**：

| 场景 | 返回 |
|---|---|
| 目标值缺失 / 非数字 / 超范围 | 400 `{"ok":false,"error":{"code":"VALIDATION_ERROR","field":"goalExerciseMinutes","message":"请填 1~600 的整数分钟"}}`（饮水同理，`field` 换 `goalWaterMl`） |
| 数据库写入失败 | 500 `DB_ERROR` |

> 注意：这个接口**不做"新建 vs 更新"两种语义**，统一 upsert——单人场景只有一条设置，前端不用判断该调 POST 还是 PUT。

> 状态：✅ 已实现（2026-10-06）。实现落点：新建 `validators/settings.validator.js`（两个目标值 + 可选 startDate）、`repositories/settings.repository.js` 加 `saveSettings`（upsert，冲突键 `user_id`）、`handlers/settings.js` 加 `handlePutSettings`，`index.js` 放开 PUT。
> **依赖一条数据库权限**：`anon` 角色要有 `settings` 的 `INSERT, UPDATE` 与 `settings_id_seq` 序列 `USAGE`（与 4.11 结论 6 的两条 GRANT 同一批，2026-10-06 已执行）。
> 验证（2026-10-06 实测）：`PUT {"goalExerciseMinutes":45,"goalWaterMl":2200}` → 200，`startDate` 仍是 `2026-09-21`；带 `startDate:"2026-01-01"` 试图覆盖 → 200，`startDate` **仍**是 `2026-09-21`（规则 2 生效）；`goalWaterMl:99999` → 400 `field:"goalWaterMl"`；`{}` → 400 `field:"goalExerciseMinutes"`；`POST` → 405。库内核对：`created_at` 保持首次时间不变、`updated_at` 随每次保存刷新。

---

### 4.5 A4 · GET /api/checkins　（列表读取，本契约的核心）

**用途**：一次取回打卡记录，供**全部四个页面**做派生计算（streak / 历史最长 / 坚持率 / 日历标记 / 体重折线 / 周运动柱状 / 标签筛选列表）。
**请求参数**（全部可选）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `from` | `YYYY-MM-DD` | 起始日期（含）。不传 = 不设下界 |
| `to` | `YYYY-MM-DD` | 结束日期（含）。不传 = 不设上界 |
| `limit` | 正整数 1~1000 | **返回条数上限**，取区间内**最新**的 N 条（2026-10-02 新增）。不传 = 不限条数 |
| 三者都不传 | — | 返回**全部记录**（单人数据量可控：一年 365 条约 100KB，前端一次拉完、本地算，比"每页各查一次"更省事） |

**校验**：日期格式非法 → 400 `INVALID_PARAM`；`from` 晚于 `to` → 400 `INVALID_PARAM`；区间跨度超过 400 天 → 400 `INVALID_PARAM`（TECH_DESIGN B6 的保护值）；`limit` 非正整数或超出 1~1000 → 400 `INVALID_PARAM`。

> `limit` 的语义是「**最新 N 条**」而不是「最早 N 条」：带上 `limit` 时先倒序取 N 条，再翻回升序返回，所以**响应里的 `items` 永远是升序**（趋势图照旧直接连线）。例：`?limit=3` 取到 09-28 / 09-29 / 10-01。

**成功响应**（200）：`items` 按 `date` **升序**排列（趋势图直接按顺序连线）。

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "date": "2026-09-21",
        "exerciseType": "慢跑",
        "exerciseMinutes": 30,
        "exerciseCalories": 300,
        "mealBreakfastText": "鸡蛋 + 牛奶",
        "mealBreakfastTag": "普通",
        "mealLunchText": "轻食沙拉",
        "mealLunchTag": "健康",
        "mealDinnerText": "",
        "mealDinnerTag": "",
        "weightKg": 65.5,
        "waterMl": 1800
      }
    ],
    "total": 1
  }
}
```

- 没有记录时：`{"ok":true,"data":{"items":[],"total":0}}`（**不是错误**，前端按空态渲染，PRD E1）；
- `total` 是本次返回条数，方便前端日志与调试时一眼核对。

**错误返回**：400 `INVALID_PARAM`、500 `DB_ERROR` / `INTERNAL_ERROR`。

> 状态：✅ 已实现（2026-10-02）。验证：浏览器依次打开 `<API_BASE>/api/checkins`（9 条）、`<API_BASE>/api/checkins?from=2026-09-27&to=2026-10-01`（3 条）、`<API_BASE>/api/checkins?from=2026-10-01&to=2026-09-01`（400）。
> 实现细节（含一条契约没写但代码里做了的固定过滤 `.eq("user_id", 0)`）见 **4.11**。

> **前端对接点（2026-10-02 已接）**：实际改的**不是** `state.js`。第 2 周留的 `fetchList(producer)` 那套设计是对的（页面只管拿 `{items}`），但真正决定"数据从哪来"的是更底层的 `assets/js/storage.js`——它是全项目唯一的数据出入口。在它底下加一层「**云端覆盖层**」后，**所有页面自动读到真库数据**，页面脚本一行未改。
> - 新增取数层 `assets/js/api-source.js`：并发调 A2 + A4，取到的数据交给 `storage.js` 的 `applyRemote()`；**取不到就回落本地数据、不白屏**。
> - 四个页面只在结尾把 `init()` 换成 `dhlApi.ready(init)`（各一行）；`state.js` / `history.js` / `stats.js` 完全没动。
> - **本期只接了读，写还在本地**（A6 排在 Day 18）。因此 `getCheckins()` 采用「云端为准 + 本地独有的日期保留」的合并规则，避免刚在打卡页保存的那天刷新后"消失"。
> **筛选说明**：按饮食标签筛选（历史页 Day 12 功能）**不单独做接口**，由前端拿到记录后本地扫描（`history.js` 的 `scanFilterHits` 逻辑照旧）。单人数据量下服务端筛没有收益，反而多一套语义要维护。

---

### 4.6 A5 · GET /api/checkins/{date}

**用途**：打卡页回填当天表单、历史页单日详情。（可与 A4 二选一，视第 3 周实现便利程度决定是否使用——登记保留。）

| 项 | 内容 |
|---|---|
| 路径参数 | `date`：`YYYY-MM-DD` |
| 请求体 | 无 |

**成功响应**（200，有记录）：

```json
{ "ok": true, "data": { "record": { "date": "2026-09-21", "weightKg": 65.5, "waterMl": 1800, "...": "其余字段同 A4" } } }
```

**成功响应**（200，那天没记录）：

```json
{ "ok": true, "data": { "record": null } }
```

**错误返回**：`date` 格式非法 → 400 `INVALID_PARAM`；数据库异常 → 500 `DB_ERROR`。

> 与 TECH_DESIGN 3.3 的 B7（写的是"单日记录或 404"）有一处调整：**这里用 200 + `record:null` 取代 404**。理由同 A2——"那天没打卡"是正常业务状态而非错误，且 404 与"网关路径不存在"的 404 混在一起，前端无法区分是哪种。第 3 周按本契约实现。

> 状态：✅ 已实现（2026-10-06）。实现落点：`handlers/checkins.js` 的 `handleGetCheckin`——**复用 A6 写完回读用的同一个 `findByDate`**，没有新增查询代码；`index.js` 的 `/api/checkins/{date}` 分支放开 GET（PUT 保持不变）。仓库层的"排序 / 条数"规矩在这一层不参与，单日读取天然只有一行。
> 验证（2026-10-06 实测）：`<API_BASE>/api/checkins/2026-10-06` → 200 + 当天完整记录；`<API_BASE>/api/checkins/2026-10-03` → 200 `{"record":null}`；`<API_BASE>/api/checkins/20261003` → 400 `INVALID_PARAM`；`POST <API_BASE>/api/checkins/2026-09-21` → 405（路径对、方法不对）。

---

### 4.7 A6 · PUT /api/checkins/{date}

**用途**：保存今日打卡 / 覆盖修改（PRD F2、E6）。这是唯一的写入口。

| 项 | 内容 |
|---|---|
| 路径参数 | `date`：`YYYY-MM-DD`（由前端按本地日期生成） |
| 请求头 | `Content-Type: application/json` |
| 请求体 | 单日记录对象，**字段同 3.2 表，不含 `date`**（日期以路径为准；若请求体里也带了 `date`，必须与路径一致，否则 400） |

请求体示例：

```json
{
  "exerciseType": "慢跑",
  "exerciseMinutes": 30,
  "exerciseCalories": 300,
  "mealBreakfastText": "鸡蛋 + 牛奶",
  "mealBreakfastTag": "普通",
  "mealLunchText": "轻食沙拉",
  "mealLunchTag": "健康",
  "mealDinnerText": "",
  "mealDinnerTag": "",
  "weightKg": 65.5,
  "waterMl": 1800
}
```

**校验规则（后端必须自己再跑一遍，前端校验只为体验）**：

| 规则 | 不通过时 |
|---|---|
| 至少有一项内容（全空不允许保存，PRD E3/B2） | 400 `VALIDATION_ERROR`，`field: "record"` |
| `exerciseMinutes` 为 0~600 整数 | 400，`field: "exerciseMinutes"` |
| `weightKg` 为 30~200 的一位小数 | 400，`field: "weightKg"` |
| `waterMl` 为 0~10000 整数 | 400，`field: "waterMl"` |
| 三个 `meal*Tag` 只能是 健康 / 普通 / 放纵 / `""` | 400，`field: "mealBreakfastTag"` 等 |
| `exerciseCalories` 为 0~9999 整数或 `""`（不重算） | 400，`field: "exerciseCalories"` |

**成功响应**（200）：

```json
{ "ok": true, "data": { "saved": true, "isNew": false, "record": { "date": "2026-09-21", "...": "保存后的完整记录" } } }
```

- `isNew: true` = 新建（页面显示「今日已打卡 ✓」）；`false` = 覆盖了原有记录（显示「已更新今日记录」，PRD E6）；
- 实现要点：`INSERT ... ON CONFLICT (user_id, date) DO UPDATE`，一条 SQL 完成覆盖保存（TECH_DESIGN 3.0 第 ④ 步）。本期 `user_id` 写固定值 `0`（见 3.4），冲突键 `(user_id, date)` 才能命中唯一约束；若写成 NULL，冲突不会发生，会插出重复记录。

**错误返回**：400 `VALIDATION_ERROR`（带 `field`）、500 `DB_ERROR` / `INTERNAL_ERROR`。
**关于删除**：A6 本身不删记录（PUT 是 upsert，存什么是什么）；删除走 **A9 `DELETE /api/checkins/{date}`**（2026-10-07 新增，原 v1.5「不建删除接口」的拍板已推翻，见第六节）。

**补充说明（2026-10-03 实现时落到代码里的细节）**：

- **字段一律全量提交**：云函数收到请求后会把 11 个业务字段**全部**写一遍（没填的写 `NULL`），所以是同一天的"整条覆盖"，不会出现"只改了一个字段、其他字段留着旧值"的半截覆盖。请求体里少给某个字段，等价于把它清空。
- **`date` 在请求体里可以不带**（前端不用传）；带了就必须与路径一致，不一致回 400 `VALIDATION_ERROR` + `field: "date"`。
- **`exerciseCalories` 单独有值不算"记了东西"**：它是前端自动算出来的，"至少有一项内容"这条只认用户真正填的项（运动类型/时长、三餐、体重、饮水）。
- **空请求体和非法 JSON 也计入校验失败**：空体按"什么都没填"处理（`field: "record"`），非法 JSON 回 400（也带 `field: "record"`）。
- **`date` 格式非法回的是 `INVALID_PARAM` 而不是 `VALIDATION_ERROR`**：日期是**路径参数**，不是请求体字段，按 2.3 的码表归 `INVALID_PARAM`（不带 `field`）；请求体里的字段问题才用 `VALIDATION_ERROR`（带 `field`）。

> 状态：✅ 已实现（2026-10-03）。验证：见 4.11「A6 线上验证清单」。
> **依赖一条数据库权限**：云函数用的凭证对应 `anon` 角色，必须给它 `INSERT, UPDATE`（含 id 自增序列的 `USAGE`）才写得进去，详见 4.11 结论 6。

---

### 4.8 A7 · POST /api/checkins/import　（迁移专用，可延后）

**用途**：把本地 localStorage 里的历史数据一次性导入云端（TECH_DESIGN 3.7 第 3、4 条）。**前端页面暂时不用它**，登记保留，第 3 周来不及就先不做。
**请求体**：

```json
{
  "schemaVersion": 2,
  "records": [ { "date": "2026-09-21", "...": "单日记录" } ]
}
```

| 项 | 约束 |
|---|---|
| `records` | 数组，单次最多 1000 条 |
| 语义 | 逐条 upsert（同 A6），已存在则覆盖 |
| 成功响应 | `{"ok":true,"data":{"imported":123}}` |
| 错误返回 | 400 `INVALID_PARAM`（超过 1000 条 / 结构不对）、400 `VALIDATION_ERROR`、500 `DB_ERROR` |

---

### 4.9 A8 · PATCH /api/checkins/{date}

**用途**：局部修改一条已存在的打卡记录（只改请求体里出现的字段，没出现的字段保持原值）。与 A6 PUT 全量覆盖互补：A6 用于"重写整天"，A8 用于"只改一个或几个字段"。

| 项 | 内容 |
|---|---|
| 路径参数 | `date`：`YYYY-MM-DD` |
| 请求头 | `Content-Type: application/json` |
| 请求体 | 一个 JSON 对象，**只带要改的字段**；`date` 不是可改字段（路径说了算），但允许出现在请求体里（必须与路径一致，否则 400） |

请求体示例（只改体重和午餐标签）：

```json
{ "weightKg": 66.0, "mealLunchTag": "健康" }
```

**可改字段**（与 3.2 表的字段一一对应，`date` 除外）：

| 字段 | 类型 | 校验 |
|---|---|---|
| `exerciseType` | string | 枚举：散步 / 慢跑 / 跳绳 / 骑行 / 力量训练 / 瑜伽 / `""` |
| `exerciseMinutes` | number \| `""` | 0~600 整数 |
| `exerciseCalories` | number \| `""` | 0~9999 整数（后端不重算） |
| `mealBreakfastText` / `mealLunchText` / `mealDinnerText` | string | ≤100 字 |
| `mealBreakfastTag` / `mealLunchTag` / `mealDinnerTag` | string | `健康` / `普通` / `放纵` / `""` |
| `weightKg` | number \| `""` | 30~200，一位小数 |
| `waterMl` | number \| `""` | 0~10000 整数 |

**校验规则**（与 A6 的字段校验同一套，但只校验请求体里**出现**的字段；"至少要改一个字段"取代 A6 的"至少有一项内容"）：

| 规则 | 不通过时 |
|---|---|
| 请求体里至少有一个可改字段（`date` 不算） | 400 `VALIDATION_ERROR`，`field: "record"`，message: "至少要改一个字段" |
| 出现的字段值非法（如 `weightKg: 500`） | 400 `VALIDATION_ERROR`，`field` 是该字段名 |
| 请求体里的 `date` 与路径不一致 | 400 `VALIDATION_ERROR`，`field: "date"` |
| 路径 `date` 格式非法 | 400 `INVALID_PARAM`（无 `field`，与 A6 同款区分） |

**成功响应**（200）：返回改之后的整条记录（与 A6 同款"回读"，前端可直接用它刷新界面）。

```json
{ "ok": true, "data": { "patched": true, "record": { "date": "2026-09-21", "...": "改之后的所有字段" } } }
```

**错误返回**：

| 场景 | 返回 |
|---|---|
| 路径 `date` 格式错 | 400 `INVALID_PARAM`（无 `field`） |
| 请求体不是合法 JSON / 不是对象 | 400 `VALIDATION_ERROR`，`field: "record"` |
| 请求体里 `date` 与路径不一致 | 400 `VALIDATION_ERROR`，`field: "date"` |
| 空请求体或只有 `date` | 400 `VALIDATION_ERROR`，`field: "record"`，message: "至少要改一个字段" |
| 字段值非法 | 400 `VALIDATION_ERROR`，`field` 是该字段名 |
| **那天没有打卡记录** | **404 `NOT_FOUND`** + 中文："`2026-10-08` 那天没有打卡记录，先去打卡页建一条再改" |
| 数据库写入失败 | 500 `DB_ERROR` |

> **为什么不存在的 date 返 404 而不是 200 + patched:false**：PATCH 改的是**已存在的记录**，那天没记录 = 目标资源不存在；与 A5 读的 200 + `record:null`（读是查询、那天没记是正常状态）语义不同——改删是状态变更，对一个不存在的目标做变更属于"目标不存在"，404 + 中文比 200 + 假成功更诚实。
> **二次确认**：前端调用前应做二次确认（"确认把 2026-09-21 的体重改成 66.0 kg 吗？"）。改虽然不删数据，但属于"动数据"，按 AGENTS.md 第八条第 5 项精神仍确认一次更稳。

> 状态：✅ 已实现（2026-10-07）。实现落点：新建 `validateCheckinPatch`（局部校验，只校验出现的字段，至少要改一个）；`repositories/checkins.repository.js` 加 `patchCheckin(values, date)`（SDK `.update().eq()` 风格，只改指定列 + `updated_at` 显式刷新）；`handlers/checkins.js` 加 `handlePatchCheckin`；`index.js` 路由放开 PATCH；`lib/response.js` 的 CORS Allow-Methods 加 `PATCH`。
> **依赖的数据库权限**：`anon` 角色要有 `UPDATE`（A6 上线时已开，PATCH 走同一个权限，不另开）。
> 验证（2026-10-07 待部署后跑）：见 4.11 的 PATCH 测试三条 curl。

---

### 4.10 A9 · DELETE（软删除）与 A10 · POST `/{date}/restore`（恢复）

> **2026-10-08 语义变更**：A9 从**真删**改成**软删除**（原 v1.8 写的"此操作不可恢复"已作废），并新增 A10 恢复接口。两节合在本节，因为它们共用同一套机制。

#### A9 · DELETE `/api/checkins/{date}`

**用途**：删掉一条打卡记录。**内部是软删除**——行不真删，只把 `is_deleted` 置 `true`；所有正常查询都带 `is_deleted = false` 过滤，所以**对调用方而言与真删完全一样**（路径、方法、请求体、响应形状、404 条件一个都没变，前端零改动）。
**为什么要软删**：真删不可逆——误删一天，`created_at` / `updated_at` 一起消失，只能 PUT 重写一条（时间戳还变了）。软删之后可以用 **A10 恢复**。

| 项 | 内容 |
|---|---|
| 路径参数 | `date`：`YYYY-MM-DD` |
| 请求头 | 无 |
| 请求体 | 无 |

**校验规则**：

| 规则 | 不通过时 |
|---|---|
| 路径 `date` 格式合法 | 400 `INVALID_PARAM`（无 `field`） |
| 那天有记录才能删 | **404 `NOT_FOUND`** + 中文："`2026-10-08` 那天没有打卡记录，删不了" |

**成功响应**（200）：不回 `record`（对调用方来说删了就是删了，没必要再回那条记录），只确认删了哪天。

```json
{ "ok": true, "data": { "date": "2026-09-21", "deleted": true } }
```

**错误返回**：

| 场景 | 返回 |
|---|---|
| 路径 `date` 格式错 | 400 `INVALID_PARAM` |
| 那天没有记录 | 404 `NOT_FOUND` + 中文 |
| 数据库删除失败 | 500 `DB_ERROR`（中文 message，不含技术结构） |

> **二次确认（仍强制，但措辞要注意）**：前端调用前**必须**二次确认（AGENTS.md 第八条第 5 项）。但**不要**再写「永远找不回来了」（与软删除事实不符），也**不要**写「可以恢复」——**页面没有恢复入口**，那会给出一个用户做不到的承诺。正确说法是「删掉后页面上就没有这一条了，只能重新打卡再记一遍」。检查台的文案已按此改过（`check.js` / `check.html`）。
> **不返 record 的理由**：与 A6/A8 不同，调用方拿这条记录已经没用了（那天从页面上消失了），回 record 只会让前端误以为记录还在；只回 `{date, deleted:true}` 让前端据此刷新列表。

> 状态：✅ 已实现（2026-10-07），**2026-10-08 由真删改为软删除**。实现落点：`repositories/checkins.repository.js` 的 `deleteByDate` 换成 **`softDeleteByDate(date)`**（SDK `.update({is_deleted: true, updated_at})...eq("is_deleted", false)` —— 只标记当前可见的那行，避免重复标记）；`handlers/checkins.js` 的 `handleDeleteCheckin` 改调它；`index.js` 路由不变；**响应形状不变，前端零改动**。
> **权限现状（有变化，值得记）**：软删除走的是 `UPDATE` —— A6 上线时已 GRANT 过，**所以不再需要 `DELETE` 权限**。2026-10-07 为真删单独开的那条 `GRANT DELETE ON public.checkins TO anon;` 现在是**多余权限**，建议二期接登录时连同写权限一并收回（`anon` 只留 `SELECT`）。本期先留着，收回要单独执行 SQL，不在本次改动范围。
> 验证：见 4.11 的 DELETE 测试 curl + SQL 前后对比（**看 `is_deleted` 列，而不是看行是否还在**）。

#### A10 · POST `/api/checkins/{date}/restore`

**用途**：**撤销 A9 的删除** —— 把 `is_deleted` 标记清掉，那天重新可见。这是软删除存在的意义（删错了能找回来）。

| 项 | 内容 |
|---|---|
| 路径参数 | `date`：`YYYY-MM-DD` |
| 请求头 | 无 |
| 请求体 | **无**（内容都还在库里没动，不需要用户再传一遍） |

**校验规则**：

| 规则 | 不通过时 |
|---|---|
| 路径 `date` 格式合法 | 400 `INVALID_PARAM`（无 `field`） |
| 那天**确实有被删的记录** | **404 `NOT_FOUND`** + 中文："`2026-10-08` 这天没有被删掉的记录，不用恢复" |

**成功响应**（200）：回恢复后的**完整记录**（前端能立刻看到内容回来了）——

```json
{ "ok": true, "data": { "date": "2026-09-21", "restored": true, "record": { "date": "2026-09-21", "...": "字段同 3.2 单日记录" } } }
```

**错误返回**：

| 场景 | 返回 |
|---|---|
| 路径 `date` 格式错 | 400 `INVALID_PARAM` |
| 那天没有被删的记录 | 404 `NOT_FOUND` + 中文 |
| 数据库恢复失败 | 500 `DB_ERROR`（中文 message） |

> **为什么是 POST，不是 PUT**：`PUT /api/checkins/{date}` 是「保存内容」，要求 11 个字段全量校验；恢复**不需要任何字段**（内容在库里原样躺着），用 PUT 等于让用户白白传一遍数据。POST 在这里表达的是「一个动作（恢复）」，不是「幂等的创建」。
> **为什么路径多一段 `/restore` 而不是复用 DELETE 加参数**：语义完全不同 —— `DELETE /{date}` = 删掉这天；`POST /{date}/restore` = 把删掉的那天找回来。混在一个地址上会让路由和语义都变糊。
> **只撤销「最近一次删除」**：`软删 → 重新打卡 → 又软删` 会在库里留下多行已删记录。恢复时若全清，会撞上部分唯一索引（同一天两条 `is_deleted = false`），所以 repository 按 `updated_at` 倒序只取**最近标记的那一行**清掉。
> 状态：✅ 已实现（2026-10-07），2026-10-08 随安全审计修复一起部署上线。实现落点：`repositories/checkins.repository.js` 加 `restoreByDate(date)`（先查最近已删行 → 再按 id 清标记）；`handlers/checkins.js` 加 `handleRestoreCheckin`；`index.js` 在「按方法分发」**之前**先拦 `rest.endsWith("/restore")` 并把这段从路径里剥掉（否则 `2026-08-01/restore` 会被当成日期去校验，直接判格式错）。
> **依赖的数据库权限**：走 `UPDATE`，A6 已开的权限，**不新增 GRANT**（与 A9 同）。

---

### 4.11 接口实现现状（2026-10-07 更新）

> 本节记录「代码到底怎么写的」，供后来接手的人排查；**接口形状仍以 4.2~4.10 为准**。

**云函数**：`cloudfunctions/api-health/`（HTTP 型，Nodejs18.15）。单入口，按 `url.pathname` 分发：

| 路由 | 状态 |
|---|---|
| `GET /api/health` | 已上线（2026-10-01） |
| `GET /api/settings` | 已上线（2026-10-02），A2 |
| `PUT /api/settings` | 已上线（2026-10-06），A3 |
| `GET /api/checkins` | 已上线（2026-10-02），A4 |
| `GET /api/checkins/{date}` | 已上线（2026-10-06），A5 |
| `PUT /api/checkins/{date}` | 已上线（2026-10-03），A6（upsert 全量覆盖） |
| `PATCH /api/checkins/{date}` | 已上线（2026-10-07），A8（局部修改） |
| `DELETE /api/checkins/{date}` | 已上线（2026-10-07），A9（**软删除**单日：只打 `is_deleted` 标记） |
| `POST /api/checkins/{date}/restore` | 已上线（2026-10-07），A10（恢复被 A9 删掉的那天） |
| 其余方法（如对 `/api/checkins/{date}` 或 `/api/settings` 发 POST） | 405 `METHOD_NOT_ALLOWED`（**注意**：`/api/checkins/{date}/restore` 是独立路径，POST 到它不算"方法不对"） |
| `/api/checkins/import`（A7）、`/api/checkins/`（后面没跟日期）与其它未登记路径 | 404 `NOT_FOUND` |

> **三处状态变化（别被旧记录误导）**：
> ①（2026-10-03）`GET /api/checkins/2026-09-21` 从 404 变成了 **405** —— A6 上线后这个**路径已经存在**了，只是当时 GET 不是它的合法方法；
> ②（2026-10-06）同一个地址的 GET 变成 **200** —— A5 上线，这个地址现在两种方法都合法（GET 读单日 / PUT 写单日）；
> ③（2026-10-07）同一个地址再加 PATCH / DELETE 两种方法合法 —— A8 / A9 上线，现在四种方法都合法（GET / PUT / PATCH / DELETE）。
> ④（2026-10-08）`/api/checkins/{date}/restore` 成为**独立合法路径**（A10）——它**不是** `/api/checkins/{date}` 的新方法，而是路径多了一段的新地址，所以在路由分发里要在"按方法分发"之前先把它拦下来。

**网关路由**：域名下只保留一条 **`/api`**（前缀匹配 + `enablePathTransmission: true`，即完整路径透传给函数）。曾经的单条 `/api/health` 路由已删除——**路由是按路径一条条建的，不放开就会连函数都进不去**。

> 排查提示：接口返回的 404 文案若是 `INVALID_PATH`，说明请求**没到函数、被网关挡了**；本函数自己的 404 文案是「没有这个接口」。

**数据库访问方式（方案乙：PG 网关 + 官方 SDK）**：

| 项 | 值 |
|---|---|
| 客户端 | `@cloudbase/node-sdk@3.18.3`，用 `app.rdb({ instance: "default", database: "public" })` |
| 凭证 | 云函数环境变量 `CLOUDBASE_APIKEY`（**只进环境变量，永不进代码 / 仓库 / 响应**） |
| 凭证类型 | 环境的 **Publishable Key**（对应数据库角色 `anon`） |

**踩过的结论（照抄即可，别再试错）**：

1. **`app.rdb()` 必须显式传 `database: "public"`**。不传时 SDK 内部按 `const { database = envId } = options` 把**环境 ID 当 schema 名**发出去，网关回 `406 DATABASE_PGRST106 Invalid schema`。
2. **通过工具通道创建的 `api_key` 类型凭证被 PG 网关拒收**（`401 INVALID_CREDENTIALS`；对照：不带凭证是 `MISSING_CREDENTIALS`，说明请求头送达了）。同一请求改带 Publishable Key 立刻 `200`。→ 本期读接口就用 Publishable Key。**二期启用登录 + RLS 时必须重定凭证策略**（读接口应转发调用方 token，或改用控制台创建的服务端 Key）。
3. **凭证失效时 SDK 会在「后台」抛未处理的 Promise 拒绝**，Node 默认直接杀进程 → 平台回 HTML 错误页，违背 2.3。云函数顶部已加进程级 `unhandledRejection` 兜底，只记日志不退出。
4. **查询固定带 `.eq("user_id", 0)`**（契约 4.5 未写此参数）：本期单人数据恒为 0，写死一处便于二期多人版收编。
5. **跨域头千万别自己写 `Access-Control-Allow-Origin`**：网关会把它和请求来源拼成非法多值，浏览器报 `Failed to fetch`（详见 2.7）。前端本地起服务（`python -m http.server`）从 `http://127.0.0.1:xxxx` 访问接口时才会暴露这个问题——**直连 URL 看不出来，必须在页面里才测得出来**。
6. **写接口要单独开表权限（2026-10-03 踩到）**：读接口一直好用，写接口第一次调用回 `500 DB_ERROR`。翻云端真实错误是 `DATABASE_42501 permission denied for table checkins` —— Publishable Key 对应的 `anon` 角色**只有 `SELECT`**，`INSERT/UPDATE` 默认没给。修的 SQL 两条（`anon` 还要能取 id 自增序列的值，少了第二条会报权限错）：
   ```sql
   GRANT INSERT, UPDATE ON public.checkins TO anon;
   GRANT USAGE, SELECT ON SEQUENCE public.checkins_id_seq TO anon;
   ```
   对照事实：`authenticated` / `service_role` 两个角色建表时就带完整读写权限，缺的只是 `anon` 这一份；本期没有登录，云函数只能以 `anon` 身份连库。
   **代价与二期动作**：Publishable Key 属于「可公开」类密钥，开了写权限后，**拿到它就能绕过云函数直接写库**（不过本期接口本来就无鉴权，见 2.5，风险增量有限）。二期接登录时必须连本带利收回：启用 RLS + 把写入口改成 `authenticated`，`anon` 只留 `SELECT`。
   > 排查手法（记下来）：临时让 `sendDbError` 把原始错误塞进响应 message 里，就能在 curl 输出里直接看到 `code`/`message`，不用等日志。查完立刻改回去，别留在线上。
7. **`PATCH` 不需要新权限（2026-10-07 验证）；`DELETE` 那条 GRANT 现已多余（2026-10-08 变）**：A8 PATCH 走 SDK `.update()`，对应数据库 `UPDATE` 权限——A6 上线时已经 GRANT 过，所以 PATCH 接口写完直接能跑。
   A9 当初是**真删**，走 SDK `.delete()` → 数据库 `DELETE` 权限（`anon` 默认没有），所以 2026-10-07 单独开了一条：
   ```sql
   GRANT DELETE ON public.checkins TO anon;
   ```
   （当时的关键区别：A6 的两条 GRANT 里有一条是给 id 自增序列的 `USAGE`；删除不生成新 id，所以那条 DELETE 只有一个 GRANT。）
   **2026-10-08 现状**：A9 已改为**软删除**（`.update({is_deleted: true})`），走的是 `UPDATE` —— **`DELETE` 权限从此不再是必需**，上面那条 GRANT 成为多余权限，建议二期连同写权限一并收回（见 4.10 的"权限现状"）。
8. **软删除的读取侧过滤是铁律（2026-10-08 补）**：所有「正常业务查询」都必须带 `is_deleted = false`（repository 里统一走一个 `visibleOnly` 包装），否则会把用户已经删掉、界面上看不见的记录又读出来 / 悄悄改掉。那种 bug 不报错，只在某天恢复时冒出来，极难查。
   **唯一故意不过滤的两处**：`softDeleteByDate`（要标记的正是当前可见行）和 `restoreByDate`（要找的正是已删行）——它们不加 `visibleOnly`，并在注释里写明理由。
9. **`settings.start_date` 是 NOT NULL 且没有默认值，所以 upsert 时必须每次都带上它**（2026-10-06 做 A3 时踩到，第一次调用直接 500 `DB_ERROR`）：
   一开始照 A6 的思路想「不把它放进列清单 = 覆盖时不动它」，**这是错的**——PG 的 `INSERT ... ON CONFLICT DO UPDATE` 是先构造 INSERT tuple、再判冲突，`NOT NULL` 检查发生在冲突判定**之前**，所以"不出现"不是"不改"，而是"插不进去"。
   （A6 的 `saveCheckin` 没踩到：checkins 的 `NOT NULL` 列 `user_id` / `date` 本来就在 values 里，其余业务列都可空、`created_at` 靠 DEFAULT。）
   **最终做法**：handler 先读现状，**已存在就把库里的原值原样传回**给 upsert——外部行为仍然是"改目标不影响 `startDate`"（契约 3.3 规则 2），值没变，坚持率分母就不动。同理，`start_date` 有了第一次值之后，**前端传什么都改不了它**（实测带 `startDate:"2026-01-01"` 的请求返回的仍是 `2026-09-21`）。

**接口是实时查库、没有缓存**：改一条数据，下次请求立刻反映。验证闭环（2026-10-02 实测通过）：

```
① 控制台 SQL 编辑器：UPDATE checkins SET weight_kg = 70.0 WHERE date = DATE '2026-09-21';   → UPDATE 1
② 刷新 <API_BASE>/api/checkins?from=2026-09-21&to=2026-09-21                                  → weightKg: 70   ✅ 跟着变
③ 改回去：UPDATE checkins SET weight_kg = 65.5 WHERE date = DATE '2026-09-21';               → weightKg: 65.5 ✅
   （顺带核对 /api/checkins 的 total —— 值改了，条数没多没少）
```

**A6 线上验证清单（2026-10-03 实测通过，三条命令）**：

```bash
B="https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com"

# ① 正常：第一次打卡（返回 isNew: true）
curl -s -X PUT "$B/api/checkins/2026-10-03" -H 'Content-Type: application/json' -d '{"waterMl":1800}'
# → {"ok":true,"data":{"saved":true,"isNew":true,"record":{...,"waterMl":1800}}}

# ② 重复：同一天再打一次（覆盖保存，返回 isNew: false；仍然是同一行，没多出第二条）
curl -s -X PUT "$B/api/checkins/2026-10-03" -H 'Content-Type: application/json' \
  -d '{"exerciseType":"慢跑","exerciseMinutes":30,"exerciseCalories":300,"mealBreakfastText":"鸡蛋 + 牛奶","mealBreakfastTag":"普通","weightKg":64.5,"waterMl":2000}'
# → {"ok":true,"data":{"saved":true,"isNew":false,"record":{"exerciseType":"慢跑",...}}}

# ③ 缺字段：请求体全空（400 + 中文提示，字段名在 field 里）
curl -s -X PUT "$B/api/checkins/2026-10-03" -H 'Content-Type: application/json' -d '{}'
# → {"ok":false,"error":{"code":"VALIDATION_ERROR","message":"这一天还什么都没填，先记一项再保存吧","field":"record"}}

# ④ 数据库侧核对（控制台 SQL 编辑器，或任何只读 SQL 入口）
#    SELECT date, exercise_type, weight_kg, water_ml, created_at, updated_at
#      FROM checkins WHERE date = DATE '2026-10-03';
#    → 只有 1 行；created_at ≠ updated_at（第一次 INSERT、第二次 UPDATE 覆盖，created_at 没被改写）
```

**A8 PATCH 线上验证清单（2026-10-07 待部署后实测）**：

```bash
B="https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com"

# ① 正常：只改体重，其他字段保持原值（响应里 record 是改之后的整条）
curl -s -X PATCH "$B/api/checkins/2026-09-21" -H 'Content-Type: application/json' -d '{"weightKg":66.0}'
# → {"ok":true,"data":{"patched":true,"record":{"date":"2026-09-21","weightKg":66,"...":其他字段保持原值"}}}

# ② 不存在的 date（404 + 中文）
curl -s -X PATCH "$B/api/checkins/2026-10-08" -H 'Content-Type: application/json' -d '{"waterMl":1500}'
# → {"ok":false,"error":{"code":"NOT_FOUND","message":"2026-10-08 那天没有打卡记录，先去打卡页建一条再改"}}

# ③ 空请求体（400 VALIDATION_ERROR，field:record "至少要改一个字段"）
curl -s -X PATCH "$B/api/checkins/2026-09-21" -H 'Content-Type: application/json' -d '{}'
# → {"ok":false,"error":{"code":"VALIDATION_ERROR","message":"至少要改一个字段","field":"record"}}

# ④ 数据库侧核对：PATCH 只改指定列，其他字段值应保持原样（与 A6 全量覆盖对比）
#    SELECT exercise_type, weight_kg, water_ml, updated_at FROM checkins WHERE date = DATE '2026-09-21';
#    → exercise_type 和 water_ml 与 PATCH 前一致，weight_kg = 66，updated_at 刷新；created_at 不变
```

**A9 DELETE 线上验证清单（2026-10-07 待部署后实测，含 SQL 前后对比）**：

```bash
B="https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com"

# 准备：先 SELECT 总数 + 那条记录的值（控制台 SQL 编辑器）
#    SELECT count(*) AS total FROM checkins;
#    SELECT date, exercise_type, weight_kg, water_ml FROM checkins WHERE date = DATE '2026-09-21';
#    → total = N，那条记录的字段值

# ① 正常：删一条存在的记录（响应不回 record）
curl -s -X DELETE "$B/api/checkins/2026-09-21" -w "\n[HTTP %{http_code}]\n"
# → {"ok":true,"data":{"date":"2026-09-21","deleted":true}}
# → HTTP 200

# ② 删后再查：总数 -1，那条记录消失
#    SELECT count(*) AS total FROM checkins;
#    → total = N - 1
#    SELECT date FROM checkins WHERE date = DATE '2026-09-21';
#    → 0 行（记录已删，无法找回）

# ③ 删一条不存在的（404 + 中文）
curl -s -X DELETE "$B/api/checkins/2026-10-08" -w "\n[HTTP %{http_code}]\n"
# → {"ok":false,"error":{"code":"NOT_FOUND","message":"2026-10-08 那天没有打卡记录，删不了"}}
# → HTTP 404

# ④ 日期格式错（400 INVALID_PARAM，无 field）
curl -s -X DELETE "$B/api/checkins/20261008" -w "\n[HTTP %{http_code}]\n"
# → {"ok":false,"error":{"code":"INVALID_PARAM","message":"地址里的日期格式不对，应该写成 2026-09-21 这样"}}
# → HTTP 400
```

**线上验证清单**：

| 请求 | 预期 |
|---|---|
| `<API_BASE>/api/health` | 200 `{"ok":true,"service":"daily-health-log-demo","time":"…"}` |
| `<API_BASE>/api/settings` | 200，`30 / 2000 / 2026-09-21` |
| `<API_BASE>/api/checkins` | 200，`total` = 表里的实际条数（建库时是 9），`date` 升序 |
| `<API_BASE>/api/checkins?from=2026-09-27&to=2026-10-01` | 200，3 条 |
| `<API_BASE>/api/checkins?from=2026-10-01&to=2026-09-01` | 400 `INVALID_PARAM` |
| `<API_BASE>/api/checkins?limit=3` | 200，3 条（最新 3 天：09-28 / 09-29 / 10-01），仍为升序 |
| `<API_BASE>/api/checkins?limit=0` | 400 `INVALID_PARAM` |
| `GET <API_BASE>/api/checkins/2026-09-21` | 200，`data.record` 是那天的完整记录（2026-10-06 起 A5 已实现；在此之前是 405） |
| `GET <API_BASE>/api/checkins/2026-10-03` | 200 `{"ok":true,"data":{"record":null}}` —— 那天没打卡是正常状态，不是错误（契约 4.6） |
| `GET <API_BASE>/api/checkins/20261003` | 400 `INVALID_PARAM`（日期格式错，与 A6 同一套校验） |
| `PUT <API_BASE>/api/checkins/2026-10-03` + `{}` | 400 `VALIDATION_ERROR`，`field: "record"` |
| `PUT <API_BASE>/api/checkins/20261003` + 任意体 | 400 `INVALID_PARAM`（日期格式） |
| `POST <API_BASE>/api/checkins/import` | 404 `NOT_FOUND`（A7 未实现） |
| `PUT <API_BASE>/api/settings` + `{"goalExerciseMinutes":30,"goalWaterMl":2000}` | 200，返回保存后的完整设置；**`startDate` 保持首次那个值不变** |
| `PUT <API_BASE>/api/settings` + `{"goalExerciseMinutes":30,"goalWaterMl":2000,"startDate":"2026-01-01"}` | 200，但 `startDate` **仍是**原值（规则 2：写了就永不覆盖） |
| `PUT <API_BASE>/api/settings` + `{"goalExerciseMinutes":30,"goalWaterMl":99999}` | 400 `VALIDATION_ERROR`，`field:"goalWaterMl"` |
| `PUT <API_BASE>/api/settings` + `{}` | 400 `VALIDATION_ERROR`，`field:"goalExerciseMinutes"` |
| `PUT <API_BASE>/api/settings` + `{"goalExerciseMinutes":30,"goalWaterMl":2000,"startDate":"2026-13-01"}` | 400 `VALIDATION_ERROR`，`field:"startDate"` |
| `POST <API_BASE>/api/settings` | 405 `METHOD_NOT_ALLOWED` |

**部署方式**：改写 `cloudfunctions/api-health/` 下的代码后，重新上传该函数目录（依赖 `node_modules` 随包或由平台安装均可，函数已开 `InstallDependency`）。**改完代码必须重新部署，只改本地文件线上不会变。**

---

## 五、页面 → 接口映射表（第 3 周前端改造清单）

> 用途：改造时逐页对照，防止漏接口或重复请求。`welcome.html` 是纯开屏页，**不调任何接口**。

| 页面 | 要的数据 | 调哪些接口 | 前端算的派生值 |
|---|---|---|---|
| `welcome.html` 开屏 | 无 | **无接口**（按钮仅跳转） | — |
| `index.html` 今日页 | 目标、今天是否已打卡、全部记录（算 streak） | A2 + A4 | 当前 streak、历史最长、提醒条差值 |
| `checkin.html` 打卡页 | 目标（判是否已设置）、当天记录（回填） | A2 + A5 | 卡路里（`calories.js` 本地算，随 A6 一起提交） |
| `history.html` 历史页 | 全部记录、目标（startDate 算坚持率） | A2 + A4 | 日历标记、streak、历史最长、坚持率、饮食健康分、标签筛选命中 |
| `trends.html` 趋势页 | 全部记录 | A4 | 体重折线、周运动柱状（近 4~8 周） |

**一次取数原则**：每页加载时并发调 A2 + A4 即可满足全部展示需求，**不要**为"日历""趋势""筛选"各写一个接口。

**接入进度（2026-10-02）**：四个页面的**读**已接上（每页并发调 A2 + A4），打开即显示云端数据；`welcome.html` 仍不调接口。

---

## 六、明确不在本契约内（防止第 3 周误建）

| 不做的东西 | 理由 |
|---|---|
| 统计类接口（`/api/stats`、streak / 坚持率 / 周汇总 / 健康分） | 已有前端 `stats.js` 现成算法，原样复用；单人数据量在前端算毫无压力（TECH_DESIGN 3.3 的取舍结论） |
| 按饮食标签筛选的接口 | 前端本地扫描即可（见 4.5 说明） |
| ~~删除记录接口（DELETE）~~ | ~~PRD 无此功能。要清数据是用户手动清浏览器存储的事，接口不开口子~~ **2026-10-07 推翻**：A9 `DELETE /api/checkins/{date}` 已实现（见 4.10），用于删除单日记录；前端强制二次确认，`anon` 角色单独 GRANT DELETE |
| 账号 / 登录接口（`/api/auth/*`） | 属二期（PRD 2.2），启动条件是"MVP 上线且连续使用满 1 个月"；本契约只登记本期要用的，不等同于二期蓝图（二期接口另见 TECH_DESIGN 3.3 B2/B3） |
| 图片上传（饮食拍照） | PRD 明确"本期不做" |
| 健康小建议接口 | 第 2 周讨论过的规则引擎，属**前端规则**（纯函数），不建接口 |
| 卡路里计算接口 | 换算表永远留在前端（TECH_DESIGN 3.7 第 5 条） |

---

## 七、第 3 周开工时要做的事（本契约的落地清单）

| # | 事项 | 依据 | 备注 |
|---|---|---|---|
| 1 | 在 PostgreSQL 里建 `checkins` / `settings` 两张表 | `db/schema.sql` | **已完成（2026-10-01）**：脚本与示例数据已生成，执行步骤、验证 SELECT、报错对照见 `db/README.md` |
| 2 | 写 A2/A3/A4/A5/A6 五个接口（A7 可延后） | 本文档第四节 | **✅ 五个全部完成（2026-10-06）**：A2 / A3 / A4 / A5 / A6 均已上线（见 4.11）。A3 的权限前置（`settings` 表的 INSERT/UPDATE + `settings_id_seq` USAGE）也已于当日执行；**A8 PATCH / A9 DELETE 2026-10-07 新增，见 4.9 / 4.10** |
| 3 | 把 `api-health` 的错误分支形状统一成 `{ok:false,error:{code,message}}` | 本文档 2.2 | **已完成（2026-10-02）**：404 / 405 / 400 / 500 全部统一；A1 的成功响应形状按 2.2 的例外保持不变。**2026-10-03 补充**：A6 上线带回 400 `VALIDATION_ERROR`（带 `field`），也走同一形状 |
| 4 | 前端接接口：页面读真库数据 | 本文档 4.5 末注 | **读已完成（2026-10-02）**：改的是 `storage.js`（加云端覆盖层）+ 新增 `api-source.js`，四个页面各改一行启动方式；`state.js` / `history.js` / `stats.js` 未动。**写仍未接**：A6 已上线，但打卡页还是先写本地（`storage.js`），前端接 A6 是下一步待办 |
| 5 | 处理 CORS（浏览器首次发请求时） | 本文档 2.7 | **已具备（2026-10-02，2026-10-03 补 PUT，2026-10-07 补 PATCH / DELETE）**：云函数只回 `Allow-Methods`（含 `PUT / PATCH / DELETE`）/ `Allow-Headers`，`Allow-Origin` 交给网关；OPTIONS 预检回 204。实测见 4.11 |
| 6 | 本地数据迁移：导出 → A7 导入 → 人工核对 | TECH_DESIGN 3.7 | 程序**永不**自动清本地数据 |
| 7 | 给 `anon` 角色开 `checkins` 写权限（含 id 序列 `USAGE`） | 本文档 4.11 结论 6 / 7 | **已完成（2026-10-03）**：两条 GRANT（INSERT/UPDATE + 序列 USAGE）已在环境里执行；**2026-10-07 补一条 DELETE 权限**（PATCH 不需新权限，走 UPDATE）；**2026-10-08 起 A9 改软删除走 UPDATE，这条 DELETE GRANT 已成多余权限**（见 4.10）；**二期接登录时必须把三项写权限一起收回**（`anon` 只留 `SELECT`，写入口改 `authenticated` + RLS） |

---

## 八、变更记录

| 版本 | 日期 | 改动 |
|---|---|---|
| v1.0 | 2026-10-01 | 初稿登记：7 个接口（1 个已上线）、2 张表、统一响应与错误形状、页面映射表、"不做"清单 |
| v1.1 | 2026-10-01 | **数据模型落地**：新增 3.4「数据库实现现状」（`user_id` 定为 `NOT NULL DEFAULT 0` 及原因、二期收编 SQL、约束清单、空值分工、`start_date` 不写触发器、索引取舍）；3.1 建表出处改为 `db/schema.sql`；4.7 补 `user_id` 固定 0 的实现要点；第七节第 1 项标记完成 |
| v1.2 | 2026-10-02 | **A2 / A4 已实现并上线**：新增 **4.9「接口实现现状」**（云函数单入口路由表、网关 `/api` 前缀路由与 `INVALID_PATH` 排查法、SDK 必填 `database: "public"`、凭证改用 Publishable Key 及 `api_key` 被网关拒收的实测结论、`unhandledRejection` 兜底、`user_id` 固定过滤、实时查库验证闭环、线上验证清单、部署方式）；2.1 基地址说明更新为 `/api` 前缀路由；4.2 补 A1 错误形状已统一；4.3 / 4.5 补状态与验证地址；4.1 总表状态更新；第七节第 2 / 3 / 5 项更新 |
| v1.3 | 2026-10-02 | **A4 新增 `limit` 查询参数**（返回条数上限，取最新 N 条、响应仍升序，取值 1~1000，越界与非数字均 400）；4.5 参数表与校验规则同步；4.9 验证清单补两条 |
| v1.4 | 2026-10-02 | **前端接接口完成**（契约 4.5 末注、第七节第 4 项）：新增取数层 `assets/js/api-source.js`，`storage.js` 加「云端覆盖层」（只走内存、不覆盖本地数据），四个页面各改一行启动方式；**2.7 CORS 按实测重写**（云函数不要自写 `Allow-Origin`，网关会拼成非法多值导致 `Failed to fetch`）；4.9 补第 5 条结论；页面映射表补接入进度；四个页面 + 开屏页页脚文案由「数据只存在浏览器里」改为「页面记录来自云端；新打卡先存在本机」 |
| v1.7 | 2026-10-06 | **A3 `PUT /api/settings` 实现并上线，7 个接口里 6 个已实现**：新建 `validators/settings.validator.js`；`repositories/settings.repository.js` 加 `saveSettings`（upsert，冲突键 `user_id`）；`handlers/settings.js` 加 `handlePutSettings`；`lib/dates.js` 加 `todayStr()`（按 GMT+8 取"服务器当天"，避免 UTC 错位）；`index.js` 放开 PUT。4.4 补状态与验证清单；4.1 / 4.9 / 第七节状态更新；**4.9 新增第 7 条踩坑：`settings.start_date` NOT NULL 无默认值，upsert 时必须每次都带上，"不覆盖"靠 handler 回填原值实现，不能靠"列清单里不放它"**；权限前置两条 GRANT（settings 表 + settings_id_seq）当日执行 |
| v1.6 | 2026-10-06 | **A5 `GET /api/checkins/{date}` 实现并上线**：`handlers/checkins.js` 加 `handleGetCheckin`（复用 A6 回读用的 `findByDate`，未新增查询代码）+ `index.js` 路由放开 GET；4.6 补状态、实现落点与三条验证；4.1 总表状态更新；4.9 补路由表、状态变化②（该地址 GET 由 405 变 200）、验证清单三条；第五节去掉「或从 A4 里挑当天」的备选说法；第七节第 2 项剩 A3 并登记其权限前置条件 |
| v1.5 | 2026-10-03 | **A6 `PUT /api/checkins/{date}` 实现并上线（本契约唯一的写入口）**：4.7 补实现细节（字段全量提交＝整条覆盖、`date` 可不带但要与路径一致、卡路里不算"内容"、空体与非法 JSON 的处理、路径日期错走 `INVALID_PARAM`）与状态；4.1 总表状态更新并**明确"本契约没有单条写入的 POST"**；4.9 路由表补 A6、补**第 6 条踩坑（`anon` 角色默认只有 SELECT，写库要 GRANT INSERT/UPDATE + 序列 USAGE）**、补 A6 三条 curl 测试命令与 SQL 核对方法；**验证清单里 `GET /api/checkins/{date}` 的预期由 404 改为 405**（路径因 A6 而存在）；第七节第 2 / 4 / 5 项更新、**新增第 7 项（anon 写权限，含二期收回动作）** |
| v1.9 | 2026-10-08 | **A9 由真删改为软删除 + 新增 A10 `POST /api/checkins/{date}/restore`，10 个接口里 9 个已实现**。主要改动：① 头部状态行 + 4.1 总表 A9 行改写、新增 A10 行，三层分工注释补 A10；② **4.10 节改写并合入 A10**（A9 软删除语义、二次确认措辞改了——不再说"永远找不回来"、A10 完整规格与 404 条件、为什么用 POST 不用 PUT、为什么只撤销最近一次删除、**权限变化：软删除走 UPDATE，2026-10-07 为真删开的 `DELETE` GRANT 已成多余权限**）；③ 4.11 路由表加 A10 行、状态变化补④（`/{date}/restore` 是独立路径，要在按方法分发前先拦）、**踩坑清单第 7 条改写 + 新增第 8 条「软删除读取侧过滤是铁律」**（顺带修掉清单里重复的编号 7）；④ 2.5 敞口说明补"也能恢复"；⑤ 附录映射表补 A10。**本文档旧版写过的"此操作不可恢复"全部作废**。 |
| v1.8 | 2026-10-07 | **A8 `PATCH /api/checkins/{date}` + A9 `DELETE /api/checkins/{date}` 实现并上线，9 个接口里 8 个已实现**。本版本**推翻 v1.5「不建删除接口」的拍板**（见第六节划掉的"删除记录接口"那行 + 注明推翻）。主要改动：① 头部状态行 + 4.1 总表加 A8/A9 两行 + 改"A6 是唯一写入口"为"A6 是唯一 upsert 写入口、A8 局部修改、A9 删除"三层分工；② 新增 4.9 节（A8 PATCH 详细说明：可改字段、校验规则、不存在的 date 返 404+中文）和 4.10 节（A9 DELETE 详细说明：强制二次确认、不可恢复、不回 record）；③ 原 4.9「接口实现现状」改名为 **4.11**，所有当前节引用从「见 4.9」改为「见 4.11」（变更记录里的历史叙述保留原编号不动，诚实原则）；④ 4.11 路由表加 PATCH/DELETE 行、补状态变化③（同一地址 4 种方法都合法）、**新增第 7 条踩坑结论：PATCH 不需新权限走 UPDATE、DELETE 要单独 GRANT 一条且不需要序列权限**、补 A8/A9 各四条 curl 验证清单（含 SQL 前后对比）；⑤ 2.5 敞口说明从"还能改"补成"还能改也能删"；⑥ 4.7 A6 的"不做：不提供 DELETE"改成指向 A9；⑦ 第七节第 7 项补 DELETE；⑧ 附表加 PATCH/DELETE 映射。**权限前置**：`GRANT DELETE ON public.checkins TO anon;`（2026-10-07 控制台执行，验证 `has_table_privilege` 三连返 t） |

---

## 附：与课程案例接口的对应关系（备查）

| 课程案例 | 本项目 | 说明 |
|---|---|---|
| `checkins` 表读写 | A4 / A5 / A6 / A8 / A9 / A10（表名同为 `checkins`） | 打卡记录（A4 列表读 / A5 单日读 / A6 全量写 / A8 局部改 / A9 软删 / A10 恢复） |
| `plan_days` 表读写 | A2 / A3（表名 `settings`） | "计划/目标"角色 |
| `GET /api/favorites`（列表读取） | **A4 `GET /api/checkins`** | 角色位相同：一次取列表供页面渲染 |
| `/api/health` | A1（已上线） | 健康检查 |
| 课程模板的 PATCH 局部修改 | **A8 `PATCH /api/checkins/{date}`**（已上线） | 局部改：只发改的字段，不动其他 |
| 课程模板的 DELETE 删除 | **A9 `DELETE /api/checkins/{date}`**（已上线） | 删除单日记录（内部软删除），前端强制二次确认 |
| （课程模板没有的撤销动作） | **A10 `POST /api/checkins/{date}/restore`**（已上线） | 撤销 A9 的删除；本项目自加，用来把"误删不可逆"这个坑补掉 |
