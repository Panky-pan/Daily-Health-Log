# 第 3 周验收材料（Daily-Health-Log）

> 产出日期：2026-10-06（当日晚间补齐 A5 / A3 后修订）　所有「证据」均为当日实测输出（接口实测时间 14:59–15:26，数据库查询经 MCP PG 通道）。
> 验收标准：**证据可查**。凡未实际验证的一律标「未执行」或「FAIL」，不含「应该可以」类表述。

---

## 〇、证据链接速查（点开就是证据）

> 下面每个链接在浏览器里直接打开，返回的 JSON 就是验收表里引用的那次实测结果。
> 写类接口（A3 / A6）是 PUT，浏览器地址栏点不开，用文末附录的 curl 命令。

| 证据 | 链接 / 命令 | 打开后应看到 |
|---|---|---|
| 公网页面（他人可访问） | [线上首页](https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/) · [**检查台**](https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/check.html) | 首页是开屏页；检查台三张卡片（健康状态 / 真实记录 / 写入测试） |
| A1 健康检查（读） | [api/health](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health) | `{"ok":true,"service":"daily-health-log-demo","time":"…"}` |
| A2 读目标设置（读） | [api/settings](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings) | `goalExerciseMinutes:30`、`goalWaterMl:2000`、`startDate:"2026-09-21"` |
| A4 打卡列表（读） | [api/checkins](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins) | `total:10`，`date` 从 09-21 到 10-06 升序 |
| A5 单日记录（读） | [api/checkins/2026-10-06](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-10-06) | 那天完整记录（散步 60 分钟 / 240 大卡 / 56.2kg / 2000ml） |
| A5 没打卡那天 | [api/checkins/2026-10-03](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-10-03) | `{"ok":true,"data":{"record":null}}` |
| A3 改目标（写） | 附录第 3 条 curl | 200，且 `startDate` 保持 `2026-09-21` 不变 |
| A6 保存打卡（写） | 附录第 4 条 curl | 200，`isNew` 首次 true / 再存 false |
| 契约文档 | [api-contract.md（GitHub）](https://github.com/Panky-pan/Daily-Health-Log/blob/main/api-contract.md) | v1.7；第 4.9 节有 7 个接口的路由表与验证清单 |
| 数据库侧核对 | 控制台 SQL 编辑器（命令见附录 SQL 段） | checkins 10 行、settings 1 行 |

---

## 一、第 3 周验收表

> 术语说明：本项目**没有**「单条写入的 POST 接口」——契约里 POST 只用于 A7 批量导入（api-contract.md 4.1）。
> 「公网可读写」在本项目 = GET 读（A1/A2/A4）+ **PUT 写**（A6，唯一写入口，upsert 覆盖保存）。

| 验收项 | 验证方法（可复现） | 结论 | 证据（实测输出摘录） | 问题与补救 |
|---|---|---|---|---|
| **1. schema/seed 脚本** | ① 文件存在性：`db/schema.sql`、`db/seed.sql`、`db/README.md`；② 库内约束核对（SQL 见下）；③ 库内行数核对 | **PASS** | ① 三文件均在仓库（schema.sql 两表：checkins 16 列 / settings 7 列，约束显式命名，可重复执行）；② 实查 `information_schema.table_constraints`：checkins 有 `checkins_user_date_key`(UNIQUE)、8 个命名 CHECK、PK；settings 有 `settings_pkey`、`settings_user_key`(UNIQUE)、2 个 goal CHECK——与 schema.sql 设计**逐条对上**；③ 实查数据：checkins 10 行（9 条 seed + 1 条 10-06 真实记录）、settings 1 行（user_id=0，30 分钟 / 2000 ml / startDate 2026-09-21）——**库里真有数据可被接口读出**，旁证：[A4 列表](https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins) 返回 `total:10` | 无。注意：重跑 schema.sql 会 DROP 清库（脚本头部已警告），真实数据在库后不可再整跑 |
| **2. GET/PUT 公网可读写接口** | 读：curl 四个 GET；写：curl PUT 新建→覆盖→读回；改目标：PUT /api/settings；错误分支：8 条 curl（命令见文末附录） | **PASS**（A1~A6，**6 个接口全部上线**） | 读：A1 `GET /api/health`→200 `{"ok":true,"service":"daily-health-log-demo","time":"2026-10-06 14:59:30"}`；A2 `GET /api/settings`→200 `{"goalExerciseMinutes":30,"goalWaterMl":2000,"startDate":"2026-09-21"}`；A4 `GET /api/checkins`→200 `total:10`、date 升序；**A5 `GET /api/checkins/2026-10-06`→200 带当天完整记录、`/2026-10-03`→200 `{record:null}`**。写：A6 PUT 新建→200 `isNew:true`；PUT 同日再存→200 `isNew:false`（库内该行 `created_at` 15:00:43 / `updated_at` 15:00:44，证明 upsert 覆盖且未多出行），测试行验完已删。**A3 `PUT /api/settings` 改 45/2200→200 且 `startDate` 仍是 `2026-09-21`；带 `startDate:"2026-01-01"` 试图覆盖→仍 `2026-09-21`**（库内 `created_at` 仍 10-01、`updated_at` 刷新为 15:26），测完已把目标改回 30/2000。错误分支 9/9 命中：区间反了 / `limit=0` → 400；PUT 空体 → 400 `field:"record"`；`POST /api/checkins/import` → 404；恶意 Origin → **403 FORBIDDEN**；A3 越界 → 400 `field:"goalWaterMl"`、非法 startDate → 400 `field:"startDate"`、`{}` → 400 `field:"goalExerciseMinutes"`、`POST /api/settings` → 405 | **FAIL · A7 `POST /api/checkins/import`（批量导入）未实现** —— 契约 4.8 登记「可延后」，本期确实没做，如实标 FAIL。影响：localStorage 里的历史数据暂无自动迁云路径（**不影响日常打卡读写**）。补救：新建 `handlers/import.js` + 仓库层批量 upsert，随时可做，不影响已上线的 6 个接口 |
| **3. 分层重构** | ① 目录结构对照 `BACKEND_LAYERS.md`；② 分层铁律 grep：`.from(` 必须全部落在 repositories/ | **PASS** | ① 实测目录：`index.js（129 行）+ lib/(7 文件) + repositories/(2) + validators/(2) + handlers/(3)`，与文档目录树一致；② `grep -rn "\.from(" cloudfunctions/api-health --include="*.js"`（排除 node_modules）→ 5 处代码调用全部在 `repositories/checkins.repository.js`(4) 与 `settings.repository.js`(1)，另 1 处为注释——**零违规**。回归记录（2026-10-05，BACKEND_LAYERS.md 第六节）：29 条请求（17 读 + 12 写）重构前后逐字 diff 通过，只归一化 A1 `time` 等必然变化字段 | 无。重构只调结构不改行为，接口响应与重构前逐字一致。**A5 / A3 两个新接口也严格照这套分层落地**：A5 没新写查询代码（复用 A6 回读用的 `findByDate`），A3 另建 `validators/settings.validator.js`。代码可查：[BACKEND_LAYERS.md](https://github.com/Panky-pan/Daily-Health-Log/blob/main/BACKEND_LAYERS.md) |
| **4. 公网检查台 URL** | 浏览器/curl 打开 [check.html](https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/check.html) | **PASS** | 实测 HTTP 200，3469 字节（他人设备可打开，见第二部分同伴结论）。页面为三卡结构：① 服务健康状态（A1）② 数据库里的真实记录（A2/A4，含最后更新时间行）③ 写入测试（日期选择 + 覆盖保存警告 + 写前确认）。版本 daily-health-log-005（2026-10-06 11:31 部署 SUCCESS） | **安全提示（重要）**：检查台含「写入测试」按钮且本期无登录——知道 URL 的人**能读也能改**数据（anon 带 INSERT/UPDATE）。**此 URL 不可公开传播**；同伴验证建议发主站首页 URL（welcome.html），交叉验证若必须用检查台，测试后立即核对数据。正解是二期登录（先接 authenticated 身份、再收 anon 写权限，顺序不可反，见 api-contract.md 2.5） |
| **5. api-contract.md 完整性** | 逐节核对文档结构 + 今日实测响应与文档声明逐条比对 | **PASS** | **v1.7**（2026-10-06 更新：v1.5 → v1.6 补 A5 → v1.7 补 A3）共 8 节 + 变更记录 + 案例对照附录：7 接口全登记（**6 上线 + A7 待实现**，状态如实标注）、统一响应形状 2.2、错误码表 2.3（400/401/403/404/405/500 六类）、字段映射 2.4、空值约定 2.6、CORS 2.7、两表结构 3.2/3.3/3.4、页面→接口映射第五节、明确不做清单第六节（7 项）、落地清单第七节、变更记录 7 版全留痕。**累计 20 余条实测响应（读 / 写 / 改目标 / 9 条错误分支）全部与契约声明一致**，无一例偏差 | 无。A3 实现中踩到并记录了一条与直觉相反的数据库事实（`start_date` NOT NULL 无默认值 → upsert 必须每次带值），已写进 4.9 第 7 条踩坑 |

**汇总：5 项中 5 项 PASS；唯一缺项 A7（批量导入）标 FAIL。子项状态：本材料初稿时标注的 A5 / A3 / A7 三个「未执行」中，**A5 与 A3 已于 2026-10-06 当日补齐、部署并实测通过**（证据见上表），仅剩 A7 未做。**

---

## 二、演示提纲（3–5 分钟）

> 顺序固定：用户问题 → 核心流程 → 提示词改写 → 验证方式 → 本周未完成项。
> 演示前准备：浏览器开好线上首页；终端备好附录的 curl 验证命令。

### 1. 用户问题（约 30 秒）

「我做了个纯前端的每日健康打卡站，数据全存浏览器 localStorage——换台设备、清个缓存，打卡记录就全没了。怎么让它真正存得住？」

一句话回答：给它配一个云端数据库 + 公网接口，前端从「只存本机」升级为「云端优先、本机兜底」。

### 2. 核心流程（约 100 秒，含一次真实写入）

1. 打开 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/`（welcome 开屏）→ 点「开启我的健康记录」进今日页 → **页面显示的就是云端 PostgreSQL 里的真库数据**（10 条记录，日期升序）。
2. 进打卡页，填今天的运动/三餐/体重/饮水 → 点保存 → 按钮变「正在打开…」→ 提示「今日已打卡 ✓」（或「已更新今日记录」）。
3. **按 F5 刷新页面** → 刚填的数据还在，日历/streak 同步更新——这就是持久化的直接证据：数据在云端库里，不在浏览器缓存里。
4. （口头带过）保存链路：前端 `calories.js` 本地算卡路里 → `api-source.js` 的 `saveCheckin()` PUT 到 A6 → 云函数校验 11 个字段 → upsert 进 PostgreSQL；云端写失败时自动落回本机并明说「已存本机」，不丢数据。

> **✅ 核心流程已于 2026-10-06 16:30 实际走通一遍**（真实浏览器、手机宽度 430px，线上环境，非本地模拟）：
>
> | 环节 | 实测结果 |
> |---|---|
> | ① 打卡页加载 | 表单自动回填当天云端数据：`散步 / 60 分钟 / 奶黄包 / 大米饭+鸭肉+白菜 / 莲藕排骨汤+大米饭 / 56.2 kg / 2000 ml`；卡路里提示「散步 60 分钟 ≈ 240 大卡」；页面提示「今天已经记过了，改完再存会覆盖原来那条」——**证明 A2 + A5 读接口在真实页面上工作** |
> | ② 真实写入 | 把饮水改成 **2100** 点保存 → 状态变「**已更新今日记录，正在返回…**」、按钮变「已更新，返回中…」——**A6 覆盖保存成功**（当天已有记录，所以是 `isNew:false`） |
> | ③ 刷新验证 | 重新打开打卡页 → 饮水显示 **2100**、体重 56.2、午餐「大米饭+鸭肉+白菜」都在——**数据在云端库里，刷新不丢** |
> | ④ 复原 | 饮水改回 **2000** 并保存，复核七个字段与走通前完全一致（未留下演示痕迹） |
>
> 截图：`demo-1-form-loaded.png`（回填）/ `demo-2-saved.png`（保存成功）/ `demo-3-after-reload.png`（刷新后数据还在）/ `demo-4-restored.png`（复原）。

### 3. 提示词改写（约 60 秒）

**改写前（模糊版）**：
> 「帮我给我的健康打卡网站加一个保存打卡记录的接口。」

**改写后（结构化版，实际用的）**：
> 「实现 api-contract.md 4.7 登记的 A6 `PUT /api/checkins/{date}`：upsert 语义（同一天再存=覆盖，返回 `isNew:false`，不是报 409）；字段校验按 4.7 的表格逐条做（时长 0~600、体重 30~200 一位小数、标签三值枚举）；错误响应统一按 2.2 的 `{ok:false,error:{code,message,field?}}`；做完用 4.9 的 curl 清单逐条验证，把实际输出贴给我看。」

**改写理由（讲三点）**：
- **钉死依据**：指向契约具体章节，AI 不用猜接口形状——字段、校验、错误码全是填空题，消灭「各写各的」返工；
- **钉死语义**：明确「upsert 覆盖」而不是「重复即拒绝」，避免做出 409 的错误设计（这两者都算"实现完了"，但行为完全不同）；
- **钉死验收**：要求用契约里的验证清单逐条跑、贴真实输出——「证据可查」代替「声称完成」。

### 4. 验证方式（约 60 秒，对应第一部分验收表）

- **读**：终端现场跑 `GET /api/health`（200，回当前时间）和 `GET /api/checkins`（200，`total:10`）——对应验收表第 2 项；
- **写**：检查台 `.../check.html` 的「写入测试」卡（或 curl PUT）演示一次真实写入 + 读回——对应第 2 项的 upsert 证据（isNew 由 true 变 false）；**演示完删掉测试行**；
- **数据库**：控制台 SQL 编辑器跑 `SELECT count(*) FROM checkins;`，接口 total 与库内行数一致——对应第 1 项；
- **分层**：现场 `grep -rn "\.from(" cloudfunctions/api-health --include="*.js"`，查询全部落在 repositories/——对应第 3 项；
- **文档**：api-contract.md v1.7 打开对着错误码表讲——今天 9 条错误分支实测全部命中（400 / 403 / 404 / 405 / 各带 field 的字段级校验）。

### 5. 本周未完成项（约 30 秒，如实列出）

| 未完成 | 原因 | 下一步 |
|---|---|---|
| A7 `POST /api/checkins/import`（本地数据批量导入）—— **FAIL** | 契约登记「可延后」，本期只服务单人日常记录，不急 | 新建 `handlers/import.js` + 仓库层批量 upsert；需要迁历史数据时再做 |
| 数据无隔离（拿到 URL 者可读也能改） | 单人无登录期的已知取舍，撤销 anon 写权限会把自己锁死（顺序约束） | 二期接登录：先上 `authenticated` 身份，再收 anon 权限 |

> **A5 / A3 已于 2026-10-06 当日补齐并部署**（本材料初稿时列为未完成，现已实测通过、契约同步到 v1.7）：单日读接口上线、打卡页回填可直接调它；改目标接口上线，改目标不再只落浏览器本地。
> 原先登记的「RUN.md 仍写数据只存本机」也不在此列——Day 20 收尾提交 `39b160e` 已补正。

**合计约 4 分 40 秒。**

---

## 三、同伴交叉验证结论（三行，已完成）

**验证时间**：2026-10-06 16:18（同伴在自己的手机微信里打开，跨设备）
**验证对象**：检查台 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/check.html`

```
能否打开检查台 URL：是
能否真实读写数据：是（「写入测试」里点写入后，记录列表里出现了该日期，刷新后数据还在）
是否有报错：无
```

### 我的独立核实（不依赖同伴自述，把「他说能读」变成「库里查得到」）

| 核实项 | 方式 | 结果 |
|---|---|---|
| 写入是否真进库 | 查 `checkins` 表 2026-10-06 那行 | `updated_at` 从当天 10:53 变成 **16:18:55**，`meal_lunch_text` = **「检查台写入测试」**——同伴确实真写进去了，不只是看了页面 |
| 接口能否读回 | `GET /api/checkins?limit=1` | 200，返回该条记录（`mealLunchText: "检查台写入测试"`） |
| 页面是否无报错 | 我自己用真实浏览器打开（手机宽度） | 卡片①绿点「服务正常，接口活着」；卡片②「共 10 条…都是数据库里的真实数据」；红色错误区未显示；横向溢出元素 0 个 |
| 静态托管可访问性 | 浏览器首次打开会拦「页面访问提示」页 | 点「确定访问」后正常进入真页面。**curl 测 200 不能代替这一条**——curl 不执行 JS，凡要给外人访问的链接都得用真浏览器走过一遍 |

> **一个副产品：这次交叉验证暴露了检查台的覆盖风险。** 同伴选的 10-06 是**已有记录**的日期，而写入是**覆盖保存**——所以站长当天的真实打卡被替换成了测试内容。取证已完成（上方核实表 + 页面截图），随后用 `PUT /api/checkins/2026-10-06` 把原值写回。
> **给后续同伴验证的操作建议**：想试写入就选一个空日期（如 20xx-12-25），或干脆只让同伴看页面、不点写入——读与看已经足够证明「真实可访问」。

> 发给同伴前必读（安全）：
> 1. 本期无登录——同伴打开**任何页面**看到的都是站长本人的真实健康数据，请提前告知，避免误会；
> 2. 检查台的「写入测试」会**真写进数据库**（覆盖保存）——请让同伴选**没有记录的日期**测试，测完由站长删除该行；
> 3. 主站验证用 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/`（只读浏览，无写入口），检查台 URL 仅限本次验证，勿转发。

---

## 附：本验收表的实测命令（终端执行，单行可粘贴）

```bash
# 读 · A1 健康检查
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health"

# 读 · A2 目标设置
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings"

# 读 · A4 列表（total 应为 10）
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins"

# 写 · A6 新建（验完记得删，DELETE 需在控制台 SQL 编辑器执行）
curl -sS -w "\n[HTTP %{http_code}]" -X PUT "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-12-25" -H "Content-Type: application/json" -d "{\"waterMl\":1000}"

# 读 · A5 单日记录（2026-10-06 上线）：有记录 → 200 带当天数据
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-10-06"

# 读 · A5 那天没打卡：也是 200，record 为 null（不是错误）
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-10-03"

# 写 · A3 改目标（2026-10-06 上线）：startDate 应纹丝不动保持 2026-09-21
curl -sS -w "\n[HTTP %{http_code}]" -X PUT "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings" -H "Content-Type: application/json" -d "{\"goalExerciseMinutes\":45,\"goalWaterMl\":2200}"

# 错误分支 · A3 越界（预期 400 field:goalWaterMl）
curl -sS -w "\n[HTTP %{http_code}]" -X PUT "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings" -H "Content-Type: application/json" -d "{\"goalExerciseMinutes\":30,\"goalWaterMl\":99999}"

# 错误分支 · 区间反了（预期 400）
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?from=2026-10-01&to=2026-09-01"

# 错误分支 · 路径对方法不对（预期 405）
curl -sS -w "\n[HTTP %{http_code}]" -X POST "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings" -H "Content-Type: application/json" -d "{}"

# 错误分支 · 恶意 Origin（预期 403）
curl -sS -w "\n[HTTP %{http_code}]" -X PUT "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-12-25" -H "Content-Type: application/json" -H "Origin: https://evil.example.com" -d "{\"waterMl\":1}"
```

```sql
-- 数据库侧核对（贴到控制台 SQL 编辑器）
SELECT count(*) FROM checkins;                                     -- 预期 10（9 seed + 1 真实）
SELECT user_id, goal_exercise_minutes, goal_water_ml, start_date FROM settings;  -- 预期 1 行：0 / 30 / 2000 / 2026-09-21
-- 演示后删除测试行（把日期换成演示时用的）：
DELETE FROM checkins WHERE user_id = 0 AND date = DATE '2026-12-25';
```

（分层验证命令：`grep -rn "\.from(" cloudfunctions/api-health --include="*.js" --exclude-dir=node_modules` —— 5 处代码调用应全部位于 `repositories/` 目录。）
