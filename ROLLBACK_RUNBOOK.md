# 回滚手册

> 面向对象：我自己（Panky）。出了问题别慌，翻到这里按层执行。
> 配套：`RELEASE_CHECKLIST.md`（发布流程）、`skills/verify-project/SKILL.md`（验证项）。
> 最后一节是 **2026-10-10 实跑的回滚演练记录**（真实耗时、命令、原始输出）。

---

## 零、先搞清楚：「回滚」在本项目分三层

本项目前后端分离部署，**三层各自独立**。出问题时先判断是哪一层坏了，只回退那一层 —— 三层全退是浪费，还会把好的那层也弄坏。

| 层 | 部署物 | 回退手段 | 数据风险 |
|---|---|---|---|
| **第一层 · 代码** | 静态托管的 6 个页面 + `assets/` | 用暂存法把上一版前端重新部署 | 无（只换页面文件） |
| **第二层 · 云函数** | `api-health` 的 nodejs 代码 | `updateFunctionCode` 部署上一版代码 | 无（代码不碰数据） |
| **第三层 · 数据** | PostgreSQL 的 `checkins` / `settings` 两张表 | **只能靠发布前导出的 JSON 备份重新导入** | **高**：这是唯一不可逆的一层 |

> **顺序原则**：先回滚「能最快恢复可用」的那一层。绝大多数事故是代码问题 → 退回上一版代码即可，**不要动数据**。
> 数据层是最后手段：只有在**表结构被改坏 / 数据被误删误改**时才用，且必须已经按发布清单 5.2 导出过备份。

---

## 一、触发条件：什么情况必须回滚

**必须立即回滚**（不用犹豫，先回滚再查原因）：

| # | 触发条件 | 具体判据 | 回滚哪一层 |
|---|---|---|---|
| T1 | 健康接口挂了 | `GET /api/health` 非 200，或返回 HTML 而非 JSON | 第二层 |
| T2 | 读接口挂了 | `GET /api/checkins` / `/api/settings` 持续 500 或超时（重试 2 次仍失败） | 第二层 |
| T3 | 写接口坏了 | 保存打卡持续失败（页面提示「已存本机」），PUT 报 500 | 第二层 |
| T4 | 页面白屏 / JS 报错 | 真浏览器打开任一页面白屏，Console 有红色语法/引用错误 | 第一层 |
| T5 | 页面功能不可用 | 导航点不动、日历渲染不出、保存按钮无响应 | 第一层 |
| T6 | 数据被写坏 | 看到记录内容错乱、条数异常减少、出现不该有的重复行 | **第三层**（先备份现状再恢复） |
| T7 | 表结构被改坏 | 接口报 `DATABASE_*` 错误、`406 PGRST106`（schema 错）、列不存在 | **第三层** + 迁移回滚 |

**可以先观察、不必立刻回滚**（但要在 30 分钟内给出处理结论）：

| 现象 | 为什么可以先观察 |
|---|---|
| 云函数冷启动慢（首次请求 2~5 秒） | 正常现象，第二次就快 |
| 单个接口偶发 1 次 500，重试即成功 | 可能是瞬时抖动；连续 3 次失败才升级为 T2/T3 |
| 检查台 `check.html` 打不开 | 开发工具，不影响主站；但要在当天修 |
| 断网时页面提示「已存本机」 | 设计内行为（本地兜底），数据没丢 |

**回滚的决策权**：T1~T5 我可以直接执行（恢复可用优先）；**T6/T7 涉及数据，必须先停下告诉 Panky，拿到确认后再动**（AGENTS.md 第八条：删除/覆盖前先列出影响范围）。

---

## 二、回滚第一层：代码（静态托管回退上一版）

**适用**：T4 / T5（页面层坏了）。

**原理**：静态托管没有「一键回退到某版本」的按钮（CloudBase 控制台有历史版本列表，但本项目用 MCP 部署）。所以做法是**用上一版源码重新部署一次** —— 结果等价于回退。

### 步骤

1. **确认目标版本**。查标签：
   ```
   git tag -l -n1
   git log --oneline -5
   ```
   记下要退回的提交（如 `v0.9-prev` → `69262ca` 的**前端部分**）。

2. **取回上一版前端文件**（不动工作区，直接写进暂存目录）。以 `fd80df5` 为例：
   ```
   mkdir -p .workbuddy/tmp/deploy-site/dist
   git archive fd80df5 welcome.html index.html checkin.html history.html trends.html assets | tar -x -C .workbuddy/tmp/deploy-site/dist
   ```
   > 注：`check.html` 若也要恢复，一并加进 `git archive` 的参数。

3. **核对暂存目录内容**：
   ```
   ls -R .workbuddy/tmp/deploy-site/dist
   ```
   应是 6 个 HTML（含 check.html 时）+ `assets/`，**不含** `*.md`、`cloudfunctions/`、`.git/`。

4. **部署**（`manageApps`，参数与发布清单 3.2 完全一致）：

   | 参数 | 值 |
   |---|---|
   | action | `deployApp` |
   | serviceName | `daily-health-log`（**不能改名**） |
   | filePath | `.workbuddy/tmp/deploy-site` |
   | buildPath | `dist` |
   | framework | `static` |
   | installCmd / buildCmd | `""` / `""` |

5. **成功标志**：返回新版本号 + `SUCCESS`（版本号会 +1，属正常 —— 它是「新的一次部署」，内容等于旧版）。

6. **清暂存目录**：`rm -rf .workbuddy/tmp/deploy-site`（AGENTS.md 允许逐个清理临时试验文件；这里是自建的暂存目录，不是项目文件）。

### 注意

- **不要用 `manageHosting`**：会换域名，域名一换 → 云函数 `ALLOWED_ORIGINS` 白名单对不上 → 全站 403。
- 回退前端**不影响**云函数与数据。

---

## 三、回滚第二层：云函数（重新部署上一版代码）

**适用**：T1 / T2 / T3（接口层坏了）。

**原理**：云函数代码在 git 里有完整历史。把上一个好版本的**整个函数目录**取回，重新部署即可。

### 步骤

1. **确认上一版代码对应的提交**（从标签或提交历史拿）：
   ```
   git log --oneline -10 -- cloudfunctions/
   ```
   本项目已知：`4737255`（Day 23 修复版，A6 正常）、`69262ca`（Day 23 加请求日志，A6 有已知 500 bug）。

2. **取回上一版代码到工作区**（两种方式，选一种）：

   **方式 A —— 只恢复单个文件**（知道是哪个文件坏了时用，风险最小）：
   ```
   git checkout 4737255 -- cloudfunctions/api-health/repositories/checkins.repository.js
   ```
   **方式 B —— 整目录恢复**（不确定坏在哪时用）：
   ```
   git checkout 4737255 -- cloudfunctions/api-health
   ```
   > `cloudfunctions/api-health/node_modules/` 是本地依赖，不在 git 里，恢复不会动它。

3. **部署**（`manageFunctions`）：

   | 参数 | 值 |
   |---|---|
   | action | `updateFunctionCode` |
   | functionName | `api-health` |
   | functionRootPath | `D:/Projects/Daily-Health-Log/cloudfunctions` |

4. **成功标志 + 生效判据**：
   - 返回 `SUCCESS`；
   - 查函数信息，`ModTime` 应**晚于**最后一次相关提交时间（这是「部署是否真的生效」的铁证，见 `TEST_EVIDENCE.md` 3.2）；
   - **行为验证**：跑发布清单 4.1 的 V1/V2/V3 + 复跑 `verify-project`。

5. **回填工作区**：回滚动作只是临时救急。确认线上稳定后，把工作区恢复到「正确的版本」（`git checkout HEAD -- cloudfunctions/` 或 `git restore cloudfunctions/`），避免下次发布把旧代码又发上去。

### 注意

- **改了 repository 一定要重新部署**：本项目曾出现「本地改完但云函数没 updateFunctionCode → 线上仍报旧错」。
  判据就是 `ModTime`。
- 云函数回退**不影响**数据库数据。

### 3.1 表结构变更的迁移回滚（第三层的预热）

若回滚涉及 **DDL**（迁移），在回滚代码的同时要把表结构退回去。本项目已有一个迁移：

`cloudbase/migrations/20261007220422_add_soft_delete_to_checkins.sql`，其 `rollbackSql` 为：

```sql
DROP INDEX IF EXISTS public.checkins_user_date_active_key;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_user_date_key UNIQUE (user_id, date);
ALTER TABLE public.checkins DROP COLUMN IF EXISTS is_deleted;
```

> ⚠️ **回滚前必须先物理删掉所有 `is_deleted = true` 的行**，否则旧约束建不回来（撞唯一性）。
> 且这条 DDL 回滚会**丢掉 `is_deleted` 列及其信息**，属不可逆 —— 执行前必须已按发布清单 5.2 导出数据备份。

执行入口：`managePgDatabase action=applyMigration`（DDL 走迁移，不用 `execute`）。

---

## 四、回滚第三层：数据恢复

> **这是唯一不可逆的一层，执行前必须停下向 Panky 报告。**

**适用**：T6 / T7（数据被写坏、误删、表结构改坏）。

**为什么只能靠备份**：项目的批量导入接口 **A7 `POST /api/checkins/import` 还没实现**（契约登记待做，见 `api-contract.md` 4.8）。所以**程序层面没有「一键恢复数据」的通道** —— 只有发布前导出的 JSON 备份 + 手工/SQL 重新导入。

### 4.1 恢复前：先备份现状（防止二次伤害）

**第一步永远是导出当前状态**，否则恢复失败就彻底没了：

```
curl -sS "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?limit=400" -o .workbuddy/drill/backup-before-restore.json -w "[HTTP %{http_code}] bytes=%{size_download}\n"
```

（若接口已经挂了导不出来，改用工作台 SQL 编辑器 `SELECT * FROM checkins;` 导出。）

### 4.2 核对备份与现有数据

| 项 | 命令 / 位置 |
|---|---|
| 备份条数 | `C:/Users/starm/.workbuddy/binaries/python/versions/3.13.12/python.exe -c "import json,io;d=json.load(io.open(r'D:\Projects\Daily-Health-Log\.workbuddy\drill\backup-before-rollback.json',encoding='utf-8'));print(len(d['data']['items']),d['data']['total'])"` |
| 备份日期清单 | 同上脚本把 `print(len(...))` 换成打印 `sorted(x['date'] for x in d['data']['items'])` |
| 现有数据条数 | 打开 `SELECT count(*) FROM checkins;`（工作台 SQL 编辑器） |

### 4.3 恢复方式（两条路）

**路线 A · 用 SQL 手工重导（推荐，可控）**

1. 进云开发控制台 → 数据库 → SQL 编辑器（详细入口见 `db/README.md` 第一节）；
2. 把 JSON 备份里的 11 条记录逐条转成 `INSERT`（可让 AI 生成 SQL 后你贴进去执行）；
3. 注意：`checkins.date` 有部分唯一索引 `checkins_user_date_active_key (user_id, date) WHERE NOT is_deleted` —— 同一天只能有一条未删记录；重导前先处理已存在的行；
4. 执行后按 4.4 验证。

**路线 B · 用 `db/seed.sql` 重建（只适合「数据可丢」的早期场景）**

⚠️ 会**清空全部数据**换成 9 条示例数据 —— 只在库里没有真实数据时用。有真实打卡记录时**禁止**使用。

### 4.4 恢复后验证

| # | 验证 | 应该看到 |
|---|---|---|
| D1 | 条数 | `SELECT count(*) FROM checkins WHERE is_deleted = false;` 与备份条数一致 |
| D2 | 日期范围 | `SELECT min(date), max(date) FROM checkins;` 与备份的 earliest/latest 一致 |
| D3 | 接口回读 | `GET /api/checkins?limit=400` → `total` 与备份一致 |
| D4 | 抽样比对 | 挑 2~3 天（含 `2026-10-06`、`2026-10-09`）逐字段与备份 JSON 比对 |
| D5 | 自动检查 | 复跑 `verify-project` → 8/8 PASS |
| D6 | 浏览器 | 打开历史页点开某天 → 内容正确 |

---

## 五、回滚后：通用验证方法

三层任何一层回滚完，都跑这套，确认「可用 + 数据没坏」：

### 5.1 三步快验（2 分钟内）

| 步骤 | 命令 / 操作 | 通过标准 |
|---|---|---|
| ① 服务活着 | 浏览器打开 `.../api/health` | 200 + `{"ok":true,...}` |
| ② 数据在 | `.../api/checkins?limit=5` | 200 + `items` 数组，条数与回滚前一致 |
| ③ 页面能用 | 真浏览器打开 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com`（**点「确定访问」**）→ 进今日页 → 进历史页点一天 | 页面渲染正常、数据正确 |

### 5.2 完整验证（回滚完成后的收尾）

1. 跑 `verify-project`：
   ```
   C:/Users/starm/.workbuddy/binaries/node/versions/22.22.2-6/node.exe skills/verify-project/scripts/verify.js
   ```
   标准：`结论: PASS 8 / FAIL 0 / SKIP 0`。
2. 跑发布清单 4.1 的 V1~V5 与 4.2 的 V6~V9（**V6 必须真浏览器**）。
3. 数据比对：导出的备份条数 vs 线上当前条数，必须一致。
4. 记录：把回滚原因、层、耗时、验证结果写进「六、演练/实战记录」。

### 5.3 回滚后必做

- [ ] 工作区代码恢复到「正确的版本」（别把旧代码留在工作区）
- [ ] 清掉 `.workbuddy/tmp/deploy-site`
- [ ] 把「为什么坏」写进当天的 `.workbuddy/memory/YYYY-MM-DD.md`
- [ ] 若是代码缺陷导致，补一条检查项进 `skills/verify-project`（让这类问题下次发版前必被拦住）

---

## 六、演练 / 实战记录

### 6.1 2026-10-10 真实回滚演练（首次）

> 目的：**不允许只列方法** —— 把 v1.0 真实替换回上一稳定版，确认公网恢复可用、数据无损坏，记录实际耗时，再恢复 v1.0。

**环境**：v1.0（`2539965`）→ 回退目标 `v0.9-prev`（云函数 `69262ca`）→ 恢复 v1.0。

#### 6.1.1 演练前基线（T0）

| 项 | 值 |
|---|---|
| 上线版本 | 前端 `daily-health-log-007`；云函数代码 `4737255` |
| 数据备份 | `.workbuddy/drill/backup-before-rollback.json`，`items=11` / `total=11` |
| 备份日期范围 | 2026-09-21 ~ 2026-10-09 |
| 基线验证 | `verify-project` → **PASS 8 / FAIL 0 / SKIP 0** |
| 版本标签 | `v1.0` → `2539965`；`v0.9-prev` → `69262ca` |

#### 6.1.2 演练时间线（实测）

| 序号 | 时刻 | 动作 | 命令 / 操作 | 实测结果 | 耗时 |
|---|---|---|---|---|---|
| R0 | 21:06 | 演练前数据备份 | `curl … /api/checkins?limit=400 -o backup-before-rollback.json` | HTTP 200，3037 字节，11 条（2026-09-21~10-09） | ~5 s |
| R1 | 21:06 | 基线验证 | `node skills/verify-project/scripts/verify.js` | **PASS 8 / FAIL 0 / SKIP 0** | ~15 s |
| R2 | 21:08:21 → 21:09:56 | **云函数回退**（改工作区 + 部署） | 见 6.1.3 | 部署成功，`ModTime=21:09:56` | **~95 s**（含 MCP 登录态重新授权等待） |
| R3 | 21:10:05 → 21:10:35 | 回退后验证（含数据比对） | 见 6.1.4 | 退化现象**真实复现**（A6 500）；数据 0 损坏 | ~30 s |
| R4 | 21:10:51 → 21:12:00 | **前端回退** | 见 6.1.5 | 版本 `daily-health-log-008` / SUCCESS，六页全 200 | **~69 s** |
| R5 | 21:12:15 → 21:13:19 | **恢复 v1.0** | 见 6.1.6 | 云函数 `ModTime=21:12:26`；前端 `daily-health-log-009` / SUCCESS | **~64 s** |
| R6 | 21:13:32 → 21:14 | 恢复后终验 | `verify-project` + 数据逐字段比对 | **PASS 8/0/0**，数据完全一致 | ~30 s |

#### 6.1.3 R2 · 云函数回退（实际执行的命令）

**① 备份当前版本（防演练后回不来）**：
```
cp cloudfunctions/api-health/repositories/checkins.repository.js .workbuddy/drill/checkins.repository.v1.0.bak
```

**② 取回上一版代码**（改用 `cp` 而非 `git checkout`，避免动栈区其他文件）：
```
git show 69262ca:cloudfunctions/api-health/repositories/checkins.repository.js > .workbuddy/drill/checkins.repository.v0.9.bak
cp .workbuddy/drill/checkins.repository.v0.9.bak cloudfunctions/api-health/repositories/checkins.repository.js
```
`diff` 确认关键差异：旧版 `saveCheckin` 用 `.upsert(..., { onConflict: "user_id,date" })`（**已知会报 500 的写法**），v1.0 版为显式二段式 upsert。

**③ 部署**：
```
manageFunctions action=updateFunctionCode, functionName=api-health, functionRootPath="D:/Projects/Daily-Health-Log/cloudfunctions"
```

**④ 结果**：返回 `已更新函数 api-health 的代码`；`queryFunctions getFunctionDetail` → **`ModTime = 2026-10-10 21:09:56`**（晚于操作时间，证明部署生效）。

> **实际插曲**：首次调用返回 `AUTH_REQUIRED`（MCP 登录态过期）。走设备码授权（用户码 `5XES-G852`，Panky 在浏览器完成确认）后 `auth status = READY`。**计入耗时的部分**：从发起授权到部署完成约 95 秒，其中授权等待是主要不确定项。

#### 6.1.4 R3 · 回退后验证

| 验证 | 命令 | 结果 |
|---|---|---|
| 服务活着 | `GET /api/health` | `200` + `{"ok":true,"service":"daily-health-log-demo","time":"2026-10-10 21:10:10"}` |
| 读接口 | `GET /api/checkins?limit=3` | `200`，返回 10-01 / 10-06 / 10-09 三条真实记录 |
| **退化现象观察（关键）** | `PUT /api/checkins/1999-01-01`（回退版） | **`500` `{"ok":false,"error":{"code":"DB_ERROR","message":"记录没存上，稍后再试一次"}}`** ← 与 Day 23/24 记录的 bug 现象完全一致 |
| 数据完好性 | 导出后与备份逐字段比对 | `items=11 total=11`，**逐字段完全一致 = True**，日期集合一致 |
| 冒烟未污染 | `GET /api/checkins/1999-01-01` | `record:null`（写失败未留残留） |

> **这一步的价值**：证明「回退确实退到了旧版本」而不是「只是重新部署了同一份代码」。若不做行为探测，无法区分这两者 —— 这正是回滚演练最容易糊弄过去的地方。

#### 6.1.5 R4 · 前端回退

**① 取上一版前端到暂存目录**：
```
rm -rf .workbuddy/tmp/deploy-site && mkdir -p .workbuddy/tmp/deploy-site/dist
git archive fd80df5 welcome.html index.html checkin.html history.html trends.html check.html assets | tar -x -C .workbuddy/tmp/deploy-site/dist
```
→ 23 个文件；安全检查：`*.md` / `.env*` / `*.key` 命中 **0**（未把文档与密钥传上公网）。

**② 部署**：
```
manageApps action=deployApp, serviceName=daily-health-log, filePath="D:/Projects/Daily-Health-Log/.workbuddy/tmp/deploy-site", buildPath=dist, framework=static, installCmd="", buildCmd=""
```

**③ 结果**：版本 **`daily-health-log-008`** / buildId `2608439902` / **SUCCESS**（21:11:40 构建完成）。
六页可访问性（curl）：`welcome 200/1631B`、`index 200/4255B`、`history 200/3760B`、`trends 200/1908B`、`checkin 200/5625B`、`check 200/6124B`。
线上 `api-source.js` 含 `humanMessage` **6 处**（与 v1.0 同源的标志）。

#### 6.1.6 R5 · 恢复 v1.0

**① 恢复云函数代码**：
```
cp .workbuddy/drill/checkins.repository.v1.0.bak cloudfunctions/api-health/repositories/checkins.repository.js
```
核对：`git status --short cloudfunctions/` **无输出**（工作区与 v1.0 提交逐字节一致）；`onConflict` 仅出现在注释第 98 行（说明已回到二段式实现）。

**② 部署云函数** → `ModTime = 2026-10-10 21:12:26`。

**③ 恢复前端**（重新打包当前源码）：
```
cp welcome.html index.html checkin.html history.html trends.html check.html .workbuddy/tmp/deploy-site/dist/
cp -r assets .workbuddy/tmp/deploy-site/dist/
```
部署 → 版本 **`daily-health-log-009`** / buildId `2608460393` / **SUCCESS**（21:13:19）。

#### 6.1.7 演练结论

| 结论项 | 结果 |
|---|---|
| 公网是否恢复可用 | **是**。前端六页全 200 + 真实 HTML（含「每日健康打卡」「身体是革命的本钱」「开启我的健康记录」）；接口 health/读/写全部正常 |
| 真浏览器人工验证（V6） | **通过**。2026-10-11 Panky 人工用浏览器打开主站 → 点「确定访问」→ **看到正常开屏页**（补上了 AI 侧无法完成的一步） |
| 数据是否无损坏 | **是**。演练前 / 退化窗口后 / 恢复后 三次导出逐字段比对**完全一致**（`items=11 total=11`，2026-09-21~10-09），冒烟日期 `1999-01-01` 已清除 |
| 云函数回退耗时 | ~95 s（**含 MCP 登录态重新授权**；不含授权约 25~30 s） |
| 前端回退耗时 | **69 s**（git archive 打包 12 s + 构建部署 57 s） |
| 恢复 v1.0 耗时 | **64 s**（云函数 ~15 s + 前端 ~49 s） |
| **单层回退总耗时（从决策到验证通过）** | **云函数层 ≈ 2 分钟**（授权已就绪时）；**前端层 ≈ 2 分钟** |
| 演练总耗时 | 21:06 → 21:14，**约 8 分钟**（含登录授权、三次数据导出比对、六页可访问性核对） |
| 暴露的问题 / 改进项 | 见 6.1.8 |

#### 6.1.8 演练暴露的问题（诚实记录）

| # | 问题 | 影响 | 改进 |
|---|---|---|---|
| P1 | **MCP 登录态每天过期**，回滚第一步就可能卡在授权等待 | 真实事故中会拖长恢复时间 | 演练前先查一次 `auth status`；或把「重新授权」写进速查卡第一步的预估耗时 |
| P2 | **浏览器自动化在本机不可用** | 无法脚本化完成「真浏览器验证」 | 本机已装 Edge 但 ① `agent-browser` 守护进程起不来 ② Edge 无头/有头模式均被 CloudBase 测试域名的「风险提醒」保护页拦住（按钮在 Shadow DOM / 独立 iframe 内，`querySelectorAll` 遍历不到）③ CDP 端口抖动 502。**结论：V6 必须由 Panky 人工用真浏览器走一遍**（已于 2026-10-11 人工完成并通过） |
| P3 | `curl` 拿到的是**真页面**，不是保护页 | 易误判「已验证」 | 再次印证铁律：**保护页只在真执行 JS 的浏览器里注入**。「curl 200」只能证明静态文件已上线，不能证明浏览器能打开 |
| P4 | 前端回退「无可见差异」 | 演练说服力打折 | 因线上前端本就等于 `v0.9-prev` 同源（`fd80df5`），回退前后页面一致。**真正可观察的退化来自云函数层**（A6 500），因此演练以后端为主 |
| P5 | 云函数回退用 `cp` 而非 `git checkout` | 与手册第 3 节的示例命令不一致 | 已保留两种写法：`git checkout <版本> -- <路径>`（手册正文）与 `cp`（本次演练）。前者更规范，建议日常用 `git checkout` |

#### 6.1.9 演练遗留物品

| 文件 | 用途 | 处置 |
|---|---|---|
| `.workbuddy/drill/backup-before-rollback.json` | 演练前数据快照（11 条） | 保留（备份惯例） |
| `.workbuddy/drill/after-rollback-check.json` | 退化窗口后快照 | 保留（比对证据） |
| `.workbuddy/drill/after-restore-check.json` | 恢复后快照 | 保留（比对证据） |
| `.workbuddy/drill/checkins.repository.v0.9.bak` | 旧版代码（演练素材） | 保留（下次演练可复用） |
| `.workbuddy/drill/checkins.repository.v1.0.bak` | v1.0 代码备份 | 保留 |

> 均在 `.workbuddy/` 下（已被 `.gitignore` 忽略，不进公网、不进 git）。临时浏览器脚本与暂存目录已清理。

---

## 七、速查卡（出问题时最短路径）

```
① 哪层坏了？
   接口挂 → 第二层（云函数）    页面坏 → 第一层（前端）    数据错 → 第三层（先报告！）

② 第二层回退（约 1~3 分钟）
   git log --oneline -10 -- cloudfunctions/     # 找上一好版本
   git checkout <好版本> -- cloudfunctions/api-health
   manageFunctions action=updateFunctionCode functionName=api-health functionRootPath="D:/Projects/Daily-Health-Log/cloudfunctions"
   → 查 ModTime 是否晚于提交 → 浏览器开 /api/health

③ 第一层回退（约 3~5 分钟）
   暂存法取上一版前端 → manageApps deployApp（serviceName=daily-health-log, buildPath=dist）
   → 真浏览器打开主站（记得点「确定访问」）

④ 第三层（不可逆，先导出再动手，且必须先问 Panky）
   导出备份 → SQL 重新导入 → verify-project 全绿

⑤ 收尾
   verify-project 8/8 → 工作区恢复正常版本 → 清 tmp → 写当天 memory
```
