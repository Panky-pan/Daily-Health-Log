# 第 3 周验收材料（Daily-Health-Log）

> 产出日期：2026-10-06　所有「证据」均为当日实测输出（接口实测时间 14:59–15:01，数据库查询经 MCP PG 通道）。
> 验收标准：**证据可查**。凡未实际验证的一律标「未执行」，不含「应该可以」类表述。

---

## 一、第 3 周验收表

> 术语说明：本项目**没有**「单条写入的 POST 接口」——契约里 POST 只用于 A7 批量导入（api-contract.md 4.1）。
> 「公网可读写」在本项目 = GET 读（A1/A2/A4）+ **PUT 写**（A6，唯一写入口，upsert 覆盖保存）。

| 验收项 | 验证方法（可复现） | 结论 | 证据（实测输出摘录） | 问题与补救 |
|---|---|---|---|---|
| **1. schema/seed 脚本** | ① 文件存在性：`db/schema.sql`、`db/seed.sql`、`db/README.md`；② 库内约束核对（SQL 见下）；③ 库内行数核对 | **PASS** | ① 三文件均在仓库（schema.sql 两表：checkins 16 列 / settings 7 列，约束显式命名，可重复执行）；② 实查 `information_schema.table_constraints`：checkins 有 `checkins_user_date_key`(UNIQUE)、8 个命名 CHECK、PK；settings 有 `settings_pkey`、`settings_user_key`(UNIQUE)、2 个 goal CHECK——与 schema.sql 设计**逐条对上**；③ 实查数据：checkins 10 行（9 条 seed + 1 条 10-06 真实记录）、settings 1 行（user_id=0，30 分钟 / 2000 ml / startDate 2026-09-21） | 无。注意：重跑 schema.sql 会 DROP 清库（脚本头部已警告），真实数据在库后不可再整跑 |
| **2. GET/PUT 公网可读写接口** | 读：curl 三个 GET；写：curl PUT 新建→覆盖→读回；错误分支：6 条 curl（命令见文末附录） | **PASS**（A1/A2/A4/A6 四接口） | 读：`GET /api/health`→200 `{"ok":true,"service":"daily-health-log-demo","time":"2026-10-06 14:59:30"}`；`GET /api/settings`→200 `{"goalExerciseMinutes":30,"goalWaterMl":2000,"startDate":"2026-09-21"}`；`GET /api/checkins`→200，`total:10`，date 升序。写（用测试日期 2026-10-05，验完已删）：PUT 新建→200 `"isNew":true`；PUT 同日再存→200 `"isNew":false`（库内该行 created_at 15:00:43 / updated_at 15:00:44，证明 upsert 覆盖且未多出行）；`GET /api/checkins?from=2026-10-05&to=2026-10-05`→200 读回与写入一致。错误分支 6/6 命中：区间反了→400 `INVALID_PARAM`；`limit=0`→400；`GET /api/checkins/{date}`→**405**（A5 未实现，路径已存在）；`POST /api/checkins/import`→404；PUT 空体→400 `VALIDATION_ERROR field:"record"` 中文文案；恶意 Origin→**403 FORBIDDEN**「这个来源不在允许名单里」 | **未执行（子项）**：A5 单日读、A3 存设置、A7 批量导入——契约登记待实现，非本验收项「可读写」范围（读写闭环已由 A4+A6 达成）。影响：改目标仍只写本地 localStorage；补救：A5 半天（仓库层 `findByDate` 已有）、A3 半天，见第五节 |
| **3. 分层重构** | ① 目录结构对照 `BACKEND_LAYERS.md`；② 分层铁律 grep：`.from(` 必须全部落在 repositories/ | **PASS** | ① 实测目录：`index.js + lib/(7 文件) + repositories/(2) + validators/(1) + handlers/(3)`，与文档目录树一致；② `grep -rn "\.from(" cloudfunctions/api-health --include="*.js"`（排除 node_modules）→ 5 处代码调用全部在 `repositories/checkins.repository.js`(4) 与 `settings.repository.js`(1)，另 1 处为注释——**零违规**。回归记录（2026-10-05，BACKEND_LAYERS.md 第六节）：29 条请求（17 读 + 12 写）重构前后逐字 diff 通过，只归一化 A1 `time` 等必然变化字段 | 无。重构只调结构不改行为，接口响应与重构前逐字一致 |
| **4. 公网检查台 URL** | 浏览器/curl 打开 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com/check.html` | **PASS** | 实测 HTTP 200，3469 字节。页面为三卡结构：① 服务健康状态（A1）② 数据库里的真实记录（A2/A4，含最后更新时间行）③ 写入测试（日期选择 + 覆盖保存警告 + 写前确认）。版本 daily-health-log-005（2026-10-06 11:31 部署 SUCCESS） | **安全提示（重要）**：检查台含「写入测试」按钮且本期无登录——知道 URL 的人**能读也能改**数据（anon 带 INSERT/UPDATE）。**此 URL 不可公开传播**；同伴验证建议发主站首页 URL（welcome.html），交叉验证若必须用检查台，测试后立即核对数据。正解是二期登录（先接 authenticated 身份、再收 anon 写权限，顺序不可反，见 api-contract.md 2.5） |
| **5. api-contract.md 完整性** | 逐节核对文档结构 + 今日实测响应与文档声明逐条比对 | **PASS** | v1.5（2026-10-03 更新）共 8 节 + 变更记录 + 案例对照附录：7 接口全登记（4 上线 + 3 待实现，状态如实标注）、统一响应形状 2.2、错误码表 2.3（400/401/403/404/405/500 六类）、字段映射 2.4、空值约定 2.6、CORS 2.7、两表结构 3.2/3.3/3.4、页面→接口映射第五节、明确不做清单第六节（7 项）、落地清单第七节、变更记录 5 版全留痕。**今日 11 条实测响应（3 读 + 2 写 + 6 错误分支）全部与契约声明一致**，无一例偏差 | 无 |

**汇总：5 项中 5 项 PASS（含子项如实标注的 3 个「未执行」：A5/A3/A7，均属契约登记的后续接口，不影响已交付的读写闭环）。**

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
- **文档**：api-contract.md v1.5 打开对着错误码表讲——今天 6 条错误分支实测全部命中。

### 5. 本周未完成项（约 30 秒，如实列出）

| 未完成 | 原因 | 下一步 |
|---|---|---|
| A5 `GET /api/checkins/{date}`（单日读，现为 405） | 排期在后（剩余顺序 A5→A3） | 仓库层 `findByDate` 已写好，加 handler 分支即可，约半天 |
| A3 `PUT /api/settings`（存目标） | 同上 | `saveSettings` + `handlePutSettings`，约半天；做时需给 settings 表同步加 anon GRANT |
| A7 批量导入（本地数据迁移） | 契约登记「可延后」 | 按需实现，POST 逐条 upsert |
| 数据无隔离（拿到 URL 者可读可改） | 单人无登录期的已知取舍，撤销 anon 写权限会把自己锁死（顺序约束） | 二期接登录：先上 `authenticated` 身份，再收 anon 权限 |

> 原先登记的「RUN.md 仍写数据只存本机」已不在此列——Day 20 收尾提交 `39b160e` 已补正（README / RUN.md / api-contract.md 三处表述与云端化事实对齐）。

**合计约 4 分 40 秒。**

---

## 三、同伴交叉验证结论模板（三行，直接填写）

```
能否打开检查台 URL：是/否 + 备注（页面是否完整显示三张卡片：服务健康状态 / 数据库里的真实记录 / 写入测试）
能否真实读写数据：是/否 + 备注（「写入测试」选一个没有记录的日期写入后，卡片②的列表里是否出现该日期；刷新后是否仍在）
是否有报错：无/有 + 报错原文摘录（卡片①的圆点是绿色还是红色、红字提示原文）
```

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

# 错误分支 · 区间反了（预期 400）
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?from=2026-10-01&to=2026-09-01"

# 错误分支 · A5 未实现（预期 405）
curl -sS -w "\n[HTTP %{http_code}]" "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/2026-09-21"

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
