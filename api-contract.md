# API 契约 ·「每日健康打卡」(Daily-Health-Log)

> 版本：v1.2　登记日期：2026-10-01　最近更新：2026-10-02
> 依据文档：PRD.md v1.2、TECH_DESIGN.md v1.4、第 2 周前端成品（welcome / index / checkin / history / trends 五页 + assets 全套 JS）
> 读者：零基础开发者（Panky）本人，以及未来任何想接手这个项目的人
>
> **本文件的状态：读接口已实现，写接口待实现。**
> 它是第 3 周建表、写接口的**唯一依据**；代码与本文档冲突时，以本文档为准；要改接口先改这里。
> 进度（2026-10-02）：**A2 `GET /api/settings`、A4 `GET /api/checkins` 已上线**（实现细节见 4.9）；两张表已建成（见 3.4）；A1 保留；A3 / A5 / A6 / A7 仍是占位登记。

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

### 2.6 关于「空值」的约定（重要，防渲染出 "null kg"）

前端第 2 周页面判断空值的写法是 `record.weightKg === ''`（见 `assets/js/history.js` 第 148 行）。

因此契约规定：

- 用户**没填**的字段 → 返回**空字符串 `""`**（不是 `null`，不是 `0`，不是 `undefined`）；
- 数值字段（分钟 / 卡路里 / 体重 / 饮水）→ 有值时返回 **number**，没值时返回 `""`；
- 三餐标签未选 → `""`（枚举值为纯文字「健康 / 普通 / 放纵」，不带图标，PRD 6.4）。

### 2.7 CORS

原生 APP 没有跨域概念，CORS 只影响浏览器。本期前端尚未接接口，先不处理；第 3 周浏览器发起请求时若被拦，在云函数响应头放行静态托管域名（TECH_DESIGN 3.0 第 ⑦ 步）。

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
| A3 | PUT | `/api/settings` | 存 / 改目标设置 | 登记待实现 |
| A4 | GET | `/api/checkins` | **列表读取**：按日期区间取打卡记录（不传参＝取全部） | **已实现（2026-10-02）** |
| A5 | GET | `/api/checkins/{date}` | 读单日记录 | 登记待实现 |
| A6 | PUT | `/api/checkins/{date}` | 保存 / 覆盖单日记录（upsert） | 登记待实现 |
| A7 | POST | `/api/checkins/import` | 批量导入（本地数据迁移专用） | 登记待实现，**可延后** |

> A2 / A4 的实现方式、凭证与踩坑记录见 **4.9**。

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

---

### 4.5 A4 · GET /api/checkins　（列表读取，本契约的核心）

**用途**：一次取回打卡记录，供**全部四个页面**做派生计算（streak / 历史最长 / 坚持率 / 日历标记 / 体重折线 / 周运动柱状 / 标签筛选列表）。
**请求参数**（全部可选）：

| 参数 | 类型 | 说明 |
|---|---|---|
| `from` | `YYYY-MM-DD` | 起始日期（含）。不传 = 不设下界 |
| `to` | `YYYY-MM-DD` | 结束日期（含）。不传 = 不设上界 |
| 两者都不传 | — | 返回**全部记录**（单人数据量可控：一年 365 条约 100KB，前端一次拉完、本地算，比"每页各查一次"更省事） |

**校验**：日期格式非法 → 400 `INVALID_PARAM`；`from` 晚于 `to` → 400 `INVALID_PARAM`；区间跨度超过 400 天 → 400 `INVALID_PARAM`（TECH_DESIGN B6 的保护值）。

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
> 实现细节（含一条契约没写但代码里做了的固定过滤 `.eq("user_id", 0)`）见 **4.9**。

> **前端对接点**：第 2 周的 `assets/js/state.js` 里 `fetchList(producer)` 已经约定了"返回 Promise，成功 `resolve({items})`、失败 `reject`"。第 3 周把这个文件的 `setTimeout` 换成对这个接口的 `fetch`，**`history.js` 一行都不用改**——这就是当初留这个函数的意义。
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
**不做**：不允许删除某天记录（PRD 无此功能），不提供 DELETE。

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

### 4.9 接口实现现状（2026-10-02）

> 本节记录「代码到底怎么写的」，供后来接手的人排查；**接口形状仍以 4.2~4.8 为准**。

**云函数**：`cloudfunctions/api-health/`（HTTP 型，Nodejs18.15）。单入口，按 `url.pathname` 分发：

| 路由 | 状态 |
|---|---|
| `GET /api/health` | 已上线（2026-10-01） |
| `GET /api/settings` | 已上线（2026-10-02） |
| `GET /api/checkins` | 已上线（2026-10-02） |
| 其余路径（含未实现的 A3/A5/A6/A7） | 404 `NOT_FOUND` |

**网关路由**：域名下只保留一条 **`/api`**（前缀匹配 + `enablePathTransmission: true`，即完整路径透传给函数）。曾经的单条 `/api/health` 路由已删除——**路由是按路径一条条建的，不放开就会连函数都进不去**。

> 排查提示：接口返回的 404 文案若是 `INVALID_PATH`，说明请求**没到函数、被网关挡了**；本函数自己的 404 文案是「没有这个接口」。

**数据库访问方式（方案乙：PG 网关 + 官方 SDK）**：

| 项 | 值 |
|---|---|
| 客户端 | `@cloudbase/node-sdk@3.18.3`，用 `app.rdb({ instance: "default", database: "public" })` |
| 凭证 | 云函数环境变量 `CLOUDBASE_APIKEY`（**只进环境变量，永不进代码 / 仓库 / 响应**） |
| 凭证类型 | 环境的 **Publishable Key**（对应数据库角色 `anon`） |

**四个踩过的结论（照抄即可，别再试错）**：

1. **`app.rdb()` 必须显式传 `database: "public"`**。不传时 SDK 内部按 `const { database = envId } = options` 把**环境 ID 当 schema 名**发出去，网关回 `406 DATABASE_PGRST106 Invalid schema`。
2. **通过工具通道创建的 `api_key` 类型凭证被 PG 网关拒收**（`401 INVALID_CREDENTIALS`；对照：不带凭证是 `MISSING_CREDENTIALS`，说明请求头送达了）。同一请求改带 Publishable Key 立刻 `200`。→ 本期读接口就用 Publishable Key。**二期启用登录 + RLS 时必须重定凭证策略**（读接口应转发调用方 token，或改用控制台创建的服务端 Key）。
3. **凭证失效时 SDK 会在「后台」抛未处理的 Promise 拒绝**，Node 默认直接杀进程 → 平台回 HTML 错误页，违背 2.3。云函数顶部已加进程级 `unhandledRejection` 兜底，只记日志不退出。
4. **查询固定带 `.eq("user_id", 0)`**（契约 4.5 未写此参数）：本期单人数据恒为 0，写死一处便于二期多人版收编。

**接口是实时查库、没有缓存**：改一条数据，下次请求立刻反映。验证闭环（2026-10-02 实测通过）：

```
① 控制台 SQL 编辑器：UPDATE checkins SET weight_kg = 70.0 WHERE date = DATE '2026-09-21';   → UPDATE 1
② 刷新 <API_BASE>/api/checkins?from=2026-09-21&to=2026-09-21                                  → weightKg: 70   ✅ 跟着变
③ 改回去：UPDATE checkins SET weight_kg = 65.5 WHERE date = DATE '2026-09-21';               → weightKg: 65.5 ✅
   （顺带核对 /api/checkins 的 total 始终为 9 —— 值改了，条数没多没少）
```

**线上验证清单**：

| 请求 | 预期 |
|---|---|
| `<API_BASE>/api/health` | 200 `{"ok":true,"service":"daily-health-log-demo","time":"…"}` |
| `<API_BASE>/api/settings` | 200，`30 / 2000 / 2026-09-21` |
| `<API_BASE>/api/checkins` | 200，`total: 9`，`date` 升序 |
| `<API_BASE>/api/checkins?from=2026-09-27&to=2026-10-01` | 200，3 条 |
| `<API_BASE>/api/checkins?from=2026-10-01&to=2026-09-01` | 400 `INVALID_PARAM` |
| `<API_BASE>/api/checkins/2026-09-21` | 404 `NOT_FOUND`（A5 未实现，属预期） |

**部署方式**：改写 `cloudfunctions/api-health/` 下的代码后，重新上传该函数目录（依赖 `node_modules` 随包或由平台安装均可，函数已开 `InstallDependency`）。**改完代码必须重新部署，只改本地文件线上不会变。**

---

## 五、页面 → 接口映射表（第 3 周前端改造清单）

> 用途：改造时逐页对照，防止漏接口或重复请求。`welcome.html` 是纯开屏页，**不调任何接口**。

| 页面 | 要的数据 | 调哪些接口 | 前端算的派生值 |
|---|---|---|---|
| `welcome.html` 开屏 | 无 | **无接口**（按钮仅跳转） | — |
| `index.html` 今日页 | 目标、今天是否已打卡、全部记录（算 streak） | A2 + A4 | 当前 streak、历史最长、提醒条差值 |
| `checkin.html` 打卡页 | 目标（判是否已设置）、当天记录（回填） | A2 + A5（或从 A4 里挑当天） | 卡路里（`calories.js` 本地算，随 A6 一起提交） |
| `history.html` 历史页 | 全部记录、目标（startDate 算坚持率） | A2 + A4 | 日历标记、streak、历史最长、坚持率、饮食健康分、标签筛选命中 |
| `trends.html` 趋势页 | 全部记录 | A4 | 体重折线、周运动柱状（近 4~8 周） |

**一次取数原则**：每页加载时并发调 A2 + A4 即可满足全部展示需求，**不要**为"日历""趋势""筛选"各写一个接口。

---

## 六、明确不在本契约内（防止第 3 周误建）

| 不做的东西 | 理由 |
|---|---|
| 统计类接口（`/api/stats`、streak / 坚持率 / 周汇总 / 健康分） | 已有前端 `stats.js` 现成算法，原样复用；单人数据量在前端算毫无压力（TECH_DESIGN 3.3 的取舍结论） |
| 按饮食标签筛选的接口 | 前端本地扫描即可（见 4.5 说明） |
| 删除记录接口（DELETE） | PRD 无此功能。要清数据是用户手动清浏览器存储的事，接口不开口子 |
| 账号 / 登录接口（`/api/auth/*`） | 属二期（PRD 2.2），启动条件是"MVP 上线且连续使用满 1 个月"；本契约只登记本期要用的，不等同于二期蓝图（二期接口另见 TECH_DESIGN 3.3 B2/B3） |
| 图片上传（饮食拍照） | PRD 明确"本期不做" |
| 健康小建议接口 | 第 2 周讨论过的规则引擎，属**前端规则**（纯函数），不建接口 |
| 卡路里计算接口 | 换算表永远留在前端（TECH_DESIGN 3.7 第 5 条） |

---

## 七、第 3 周开工时要做的事（本契约的落地清单）

| # | 事项 | 依据 | 备注 |
|---|---|---|---|
| 1 | 在 PostgreSQL 里建 `checkins` / `settings` 两张表 | `db/schema.sql` | **已完成（2026-10-01）**：脚本与示例数据已生成，执行步骤、验证 SELECT、报错对照见 `db/README.md` |
| 2 | 写 A2/A3/A4/A5/A6 五个接口（A7 可延后） | 本文档第四节 | **部分完成（2026-10-02）**：A4 `GET /api/checkins`、A2 `GET /api/settings` 已上线（见 4.9）；剩余顺序：A6 写 → A3 → A5 |
| 3 | 把 `api-health` 的错误分支形状统一成 `{ok:false,error:{code,message}}` | 本文档 2.2 | **已完成（2026-10-02）**：404 / 405 / 400 / 500 全部统一；A1 的成功响应形状按 2.2 的例外保持不变 |
| 4 | 前端接接口：换掉 `state.js` 的模拟取数 | 本文档 4.5 末注 | 单点改造，`history.js` 不动 |
| 5 | 处理 CORS（浏览器首次发请求时） | 本文档 2.7 | **已具备（2026-10-02）**：云函数响应头已带 `Access-Control-Allow-Origin: *` 并放行 OPTIONS 预检；前端真正发起跨域请求时若仍被拦，再按 2.7 收紧白名单 |
| 6 | 本地数据迁移：导出 → A7 导入 → 人工核对 | TECH_DESIGN 3.7 | 程序**永不**自动清本地数据 |

---

## 八、变更记录

| 版本 | 日期 | 改动 |
|---|---|---|
| v1.0 | 2026-10-01 | 初稿登记：7 个接口（1 个已上线）、2 张表、统一响应与错误形状、页面映射表、"不做"清单 |
| v1.1 | 2026-10-01 | **数据模型落地**：新增 3.4「数据库实现现状」（`user_id` 定为 `NOT NULL DEFAULT 0` 及原因、二期收编 SQL、约束清单、空值分工、`start_date` 不写触发器、索引取舍）；3.1 建表出处改为 `db/schema.sql`；4.7 补 `user_id` 固定 0 的实现要点；第七节第 1 项标记完成 |
| v1.2 | 2026-10-02 | **A2 / A4 已实现并上线**：新增 **4.9「接口实现现状」**（云函数单入口路由表、网关 `/api` 前缀路由与 `INVALID_PATH` 排查法、SDK 必填 `database: "public"`、凭证改用 Publishable Key 及 `api_key` 被网关拒收的实测结论、`unhandledRejection` 兜底、`user_id` 固定过滤、实时查库验证闭环、线上验证清单、部署方式）；2.1 基地址说明更新为 `/api` 前缀路由；4.2 补 A1 错误形状已统一；4.3 / 4.5 补状态与验证地址；4.1 总表状态更新；第七节第 2 / 3 / 5 项更新 |

---

## 附：与课程案例接口的对应关系（备查）

| 课程案例 | 本项目 | 说明 |
|---|---|---|
| `checkins` 表读写 | A4 / A5 / A6（表名同为 `checkins`） | 打卡记录 |
| `plan_days` 表读写 | A2 / A3（表名 `settings`） | "计划/目标"角色 |
| `GET /api/favorites`（列表读取） | **A4 `GET /api/checkins`** | 角色位相同：一次取列表供页面渲染 |
| `/api/health` | A1（已上线） | 健康检查 |
