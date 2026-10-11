# 发布清单 · v1.0

> 面向对象：我自己（Panky）。每次发布照这份清单从上往下打勾，不靠记忆。
> 配套文件：`ROLLBACK_RUNBOOK.md`（回滚手册）、`skills/verify-project/SKILL.md`（自动检查项定义）。
> 本版清单依据：2026-10-10 21:06 实际发布前检查（8/8 PASS）。

---

## 一、版本信息

| 项 | 值 |
|---|---|
| **版本号** | `v1.0`（首发稳定版） |
| 对应 Git 提交 | `2539965` —「Day 25｜发布前检查 Skill 入库并实跑验证」 |
| Git 标签 | `v1.0` → `2539965`；对比基准 `v0.9-prev` → `69262ca` |
| 发布日期 | 2026-10-10 |
| 静态托管版本 | `daily-health-log-009`（首发 `-007`；`-008`/`-009` 为当日回滚演练产生） |
| 云函数版本 | `api-health`，代码对应提交 `4737255` |
| 数据库 | CloudBase PostgreSQL，环境 `daily-health-log-d3eej7197499a30`，schema `public` |

### 1.1 本次发布内容说明

**前端（静态托管）**

| 页面 / 文件 | 说明 |
|---|---|
| `welcome.html` | 开屏页，站点入口（静态托管首页文档） |
| `index.html` | 今日页：今日目标、打卡入口、连续天数、饮食健康分 |
| `checkin.html` | 打卡页：运动 / 三餐 + 标签 / 体重 / 饮水，保存后回今日页 |
| `history.html` | 历史记录页：日历、统计、标签筛选、单日详情 |
| `trends.html` | 趋势页：体重折线 + 每周运动时长柱状 |
| `check.html` | 检查台（**开发用，不可外传**：含「写入测试」按钮） |
| `assets/js/api-source.js` | 前端取数层：8 个接口封装 + 中文错误收敛（`humanMessage`） |
| `assets/css/style.css` | 全站样式：奶油色底 + 绿色主色、圆角卡片、轻动效 |
| `skills/verify-project/` | 发布前自动检查 Skill（`SKILL.md` + `scripts/verify.js`），随仓库走 |

**云函数 `api-health`（HTTP 型，监听 9000 + `scf_bootstrap`）**

已上线 9 个接口（契约 `api-contract.md` v1.9）：

| 编号 | 方法 + 路径 | 说明 |
|---|---|---|
| A1 | `GET /api/health` | 健康检查（响应形状是契约唯一例外） |
| A2 | `GET /api/settings` | 读目标设置 |
| A3 | `PUT /api/settings` | 存 / 改目标设置（upsert） |
| A4 | `GET /api/checkins` | 列表读取（支持 `limit` / `from` / `to`） |
| A5 | `GET /api/checkins/{date}` | 读单日（无记录回 200 + `record:null`） |
| A6 | `PUT /api/checkins/{date}` | 保存 / 覆盖单日（upsert 全量覆盖） |
| A8 | `PATCH /api/checkins/{date}` | 局部修改（只写请求体出现的列） |
| A9 | `DELETE /api/checkins/{date}` | **软删除**（只打 `is_deleted`） |
| A10 | `POST /api/checkins/{date}/restore` | 恢复（清掉 A9 的标记） |

**本次未包含**：A7 `POST /api/checkins/import`（批量导入，登记待做）；登录与账号体系（二期）。

### 1.2 本版相对上一稳定版的变化

相对 `v0.9-prev`（云函数 `69262ca`）：

| 变化 | 影响 |
|---|---|
| A6 写入 500 修复（`4737255`）：`onConflict` 推断部分唯一索引失效 → 改显式二段式 upsert | **关键修复**：打卡能真正存进云端 |
| 前端错误提示统一中文（`fd80df5`）：新增 `humanMessage()` | 用户不再看到 `Failed to fetch` |
| 发布前检查 Skill 入库（`2539965`） | 发布流程可执行化 |
| 文档：契约升 v1.9、测试清单与证据补录 | 无运行时影响 |

> **注意**：`v0.9-prev` 的云函数代码**带已知 Bug**（体重/记录写不进云端）。它只作为回滚演练的对比基准，**不是**可长期运行的版本。

---

## 二、发布前必须通过的验证项

### 2.1 主检查：verify-project（必须 8/8 PASS，0 FAIL）

**怎么跑**（在项目根目录，单行命令）：

```
C:/Users/starm/.workbuddy/binaries/node/versions/22.22.2-6/node.exe skills/verify-project/scripts/verify.js
```

也可在对话里说「跑一下 verify-project 做发布前检查」。

**判据**：末尾汇总必须为 `结论: PASS 8 / FAIL 0 / SKIP 0`，退出码 0。
**任一 FAIL → 阻断发布**，先按 `SKILL.md` 的「排错速查」定位修复，再重跑。

| # | 检查项 | 通过判据 | 2026-10-10 实测 |
|---|---|---|---|
| 1-A1 | 健康接口 `GET /api/health` | HTTP 200 + `ok:true` + `service`/`time` 均为字符串且 `time` 以 `20` 开头 | **PASS** |
| 2-A4 | 读接口 `GET /api/checkins?limit=3` | 200 + `items` 是数组 + **文字字段空值是 `""` 不是 `null`** + `date` 升序 | **PASS**（样例 dates 3 条） |
| 3-A6 | 写接口往返 `PUT→GET→DELETE` | PUT 200 `saved:true`；**GET 回读逐字段一致（不一致字段 = 0）**；DELETE 后回读 `record:null` | **PASS**（冒烟日 `1999-01-01` 已清理） |
| 4-SEC | 代码与 Git 无硬编码密钥 | 工作区命中 0 行；git 历史赋值命中 0 条；`.env` 未被跟踪 | **PASS**（⚠️ 见 2.3 限制） |
| 5-DB | 数据库可连接 + 核心表存在 | `/api/settings` 200 且 `goalExerciseMinutes` 存在；`/api/checkins` 200 且 `items` 数组 + `total` 数字 | **PASS** |
| A-BASE | 前端接口基地址与线上一致 | `api-source.js` 的 `API_BASE` === 脚本使用的 BASE | **PASS** |
| B-SYNTAX | 关键 JS 语法检查 | 5 个文件 `node --check` 等价检查全过 | **PASS**（语法错 0） |
| C-WRITE | 写权限通道正常 | PATCH 不存在日期返回 **404**（说明进到业务层；若 500 可能是 `42501` 权限被误收） | **PASS** |

### 2.2 发布前的额外人工确认（脚本查不到）

| # | 确认项 | 怎么确认 | 合格标准 |
|---|---|---|---|
| M1 | **工作区干净** | `git status --short` | 无输出（发布构建来自已提交的代码） |
| M2 | **无未提交改动被漏发** | 对照发布内容说明核对 `git diff v0.9-prev..HEAD --stat` | 改动文件都在第一节列过 |
| M3 | **暂存目录内容正确** | 看 `.workbuddy/tmp/deploy-site/dist/` 文件清单 | **只有** 6 个 HTML + `assets/`；**不含** `.git/`、`*.md`、`cloudfunctions/`、`db/` |
| M4 | **密钥不随包外泄** | 检查暂存目录里无 `.env`、无 `*.key`、无连接串 | 0 命中 |
| M5 | **发布前已导出数据** | 备份文件存在且非空（见 4.2） | 有当次导出的 JSON |

### 2.3 已诚实标注的限制（不掩盖）

- **4-SEC 的 git 历史侧在沙盒里可能没真跑**：脚本会打印「⚠️ git 不可用，历史侧未真正校验」。要完整校验，请在修好 PATH 的终端手工跑 `git log -S 'CLOUDBASE_APIKEY=' --oneline --all`（应无输出）。
- **检查 5 用线上接口当探针**，未直连 SQL 校验表结构。需要时用 `db/README.md` 的「二、验证：5 组 SELECT」在工作台 SQL 编辑器补跑。
- **写往返还的是软删除**（`is_deleted=true`），不是物理删除 —— 这是 A9 的设计（保留历史），不影响业务可见性。

---

## 三、发布方式

> 铁律：**前端只能用 `manageApps`**，不能用 `manageHosting`（后者会换域名，白名单里的域名一改就全站 403）。

### 3.1 发布前：准备暂存目录（暂存法）

**为什么用暂存法**：直接在项目根部署会把 `.git/`、全部 `*.md` 文档、云函数源码、`db/` 一起传上公网。暂存法只拷要上线的文件。

1. 清空并重建暂存目录：
   ```
   mkdir -p .workbuddy/tmp/deploy-site/dist
   ```
2. 拷贝 6 个页面 + 完整 `assets/` 到 `dist/`：
   ```
   cp welcome.html index.html checkin.html history.html trends.html check.html .workbuddy/tmp/deploy-site/dist/
   cp -r assets .workbuddy/tmp/deploy-site/dist/
   ```
3. 核对清单（应有 6 HTML + assets 下全部 css/js/img，共约 20+ 个文件）：
   ```
   ls -R .workbuddy/tmp/deploy-site/dist
   ```
4. 按 2.2 的 M3 / M4 确认目录内容。

### 3.2 发布前端（静态托管）

`manageApps`，参数**一个都不能少**（少 `buildPath` 会构建失败，见「踩坑」）：

| 参数 | 值 |
|---|---|
| action | `deployApp` |
| serviceName | `daily-health-log`（**必须沿用同名，才有同一子域名**） |
| filePath | `.workbuddy/tmp/deploy-site` |
| buildPath | `dist` |
| framework | `static` |
| installCmd | `""`（空，跳过远端安装） |
| buildCmd | `""`（空，跳过远端构建） |

**成功标志**：返回新版本号（形如 `daily-health-log-008`）+ `SUCCESS`。
**发布后**：删除暂存目录 `.workbuddy/tmp/deploy-site`（AGENTS.md：临时文件当天清掉）。

### 3.3 发布云函数（仅当云函数代码有改动时）

`manageFunctions`，参数：

| 参数 | 值 |
|---|---|
| action | `updateFunctionCode` |
| functionName | `api-health` |
| functionRootPath | `D:/Projects/Daily-Health-Log/cloudfunctions` |

**成功标志**：返回 `SUCCESS`；随后查函数 `ModTime` 应晚于最后一次提交时间（这是「部署是否生效」的判据，见 `TEST_EVIDENCE.md` 3.2）。

### 3.4 发布顺序

**先云函数、后前端**（或反之皆可，但**必须先跑通 2.1 的检查**）。若本次只有一端改动，只发布那一端，另一端不动。

---

## 四、发布后逐项验证步骤

> 全部按「可亲眼确认」写：每条都给**贴到哪里**与**应该看到什么**。

### 4.1 接口层（贴到浏览器地址栏或终端）

| # | 验证项 | 地址 / 命令 | 应该看到 |
|---|---|---|---|
| V1 | 健康状态 | 浏览器打开 `https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health` | `{"ok":true,"service":"daily-health-log-demo","time":"2026-10-10 …"}` |
| V2 | 真实数据 | 同上把末尾换成 `/api/checkins?limit=5` | `{"ok":true,"data":{"items":[…]}}`，含 2026-10-09 等真实记录 |
| V3 | 目标设置 | 同上换成 `/api/settings` | `"goalExerciseMinutes":30,"goalWaterMl":2000`（按你自己设的值） |
| V4 | 跨域白名单 | 终端单行：`curl -sS -w "\n[HTTP %{http_code}]\n" -H "Origin: https://evil.example" https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health` | `[HTTP 403]` +「这个来源不在允许名单里」 |
| V5 | 复跑自动检查 | 终端单行见 2.1 | `结论: PASS 8 / FAIL 0 / SKIP 0` |

### 4.2 页面层（**必须用真浏览器**，curl 不算）

| # | 验证项 | 操作 | 应该看到 |
|---|---|---|---|
| V6 | 站点可打开 | 浏览器打开 `https://daily-health-log-daily-health-log-d3eej7197499a30.webapps.tcloudbase.com` | **先弹「页面访问提示」，点「确定访问」** → 看到开屏页与「每日健康打卡」 |
| V7 | 五页互跳 | 依次点顶部导航：今日 / 打卡 / 历史 / 趋势 | 每页都渲染出内容，无白屏、无红字报错 |
| V8 | 数据来自云端 | 历史页点一个有标记的日期 | 显示当天真实内容；F12 Console 输入 `dhlApi.getResult()` → `{ok: true, count: 11}` |
| V9 | 保存能上云 | 打开打卡页，填一项 → 点「保存今日打卡」 | 出现成功提示（**不是**「已存本机」红字）；F5 刷新记录还在 |

> ⚠️ **V6 是必须真浏览器的一步**：静态托管测试域名有「访问保护页」，`curl` 不执行 JS，照样返回 200 与真 HTML ——「curl 测到 200」**不能**证明「别人能打开」。

### 4.3 发布结果记录（每次发布填一行）

| 日期 | 版本 | 静态托管版本 | 云函数 | verify 结果 | V6~V9 | 备注 |
|---|---|---|---|---|---|---|
| 2026-10-10 | v1.0 | `daily-health-log-009` | `4737255` | PASS 8/0/0 | **V6 PASS**（2026-10-11 Panky 人工确认：点「确定访问」后看到正常开屏页） | 首发稳定版；当天完成回滚演练（见 `ROLLBACK_RUNBOOK.md` 6.1），演练用版本 `-008`（回退）/ `-009`（恢复） |

> **V6 说明（已闭环）**：本机 `agent-browser` 守护进程起不来，Edge 无头/有头模式均被测试域名的「风险提醒」保护页拦住（按钮在 Shadow DOM / iframe 内，脚本遍历不到），AI 侧只能用 `curl` 证明静态文件正确。**保护页之后的实际渲染已由 Panky 于 2026-10-11 用真浏览器人工确认通过**（点「确定访问」→ 正常开屏页）。
>
---

## 五、备份方式

发布前**必须**做完这两件事，缺任一件就不许发布。

### 5.1 代码版本标记（git tag）

**为什么**：光有提交历史不够 —— 回滚时要一口说出「上一版是哪个点」。标签让这件事变成一条命令。

```
git tag -a v1.0 -m "v1.0 首发稳定版（说明见 RELEASE_CHECKLIST.md）" 2539965
git tag -a v0.9-prev -m "v0.9-prev 上一稳定版（回滚基准）" 69262ca
git push origin v1.0 v0.9-prev
```

**核对**：

```
git tag -l -n1
```

应看到两个标签及各自说明。发新版本时，**先把当前标签改名/保留，再给新提交打新标签**（形如 `v1.1`），并记录上一标签是谁（回滚手册要用）。

### 5.2 数据导出（发布含表结构变更时**强制**）

**为什么必须**：A7 批量导入接口**还没实现**（契约登记待做），所以数据恢复**只能靠发布前导出的备份重新导入**。库改坏了没有备份 = 数据没了。

**导出（贴到终端，单行）** —— 产出全部可见记录的 JSON：

```
curl -sS "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?limit=400" -o .workbuddy/drill/backup-before-rollback.json -w "[HTTP %{http_code}] bytes=%{size_download}\n"
```

**同时导出设置表**（贴到终端，单行）：

```
curl -sS "https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/settings" -o .workbuddy/drill/backup-settings.json -w "[HTTP %{http_code}] bytes=%{size_download}\n"
```

**核对备份有效**（不是空文件、条数对得上）：

```
C:/Users/starm/.workbuddy/binaries/python/versions/3.13.12/python.exe -c "import json,io;d=json.load(io.open(r'D:\Projects\Daily-Health-Log\.workbuddy\drill\backup-before-rollback.json',encoding='utf-8'));print('items=',len(d['data']['items']),'total=',d['data']['total'])"
```

应打印 `items= 11 total= 11`（以当前实际条数为准）。

### 5.3 备份存放约定

| 内容 | 位置 | 说明 |
|---|---|---|
| 数据 JSON 备份 | `.workbuddy/drill/`（本地，**不进 git**） | `.workbuddy/` 已被 `.gitignore` 忽略，数据不会上公网 |
| 表结构 DDL | `db/schema.sql`（在 git 里） | 建表脚本，可重复执行 |
| 变更迁移 | `cloudbase/migrations/`（在 git 里） | 每次 DDL 变更一个文件，含 `rollbackSql` |
| 代码版本 | git tag（在 git 里） | `v1.0` / `v0.9-prev` 等 |

> **注意**：数据备份放在 `.workbuddy/` 本地目录，**换电脑就没有了**。若某次发布涉及重要数据，请额外把 JSON 备份复制到 git 仓库外的第三处（如自己的网盘），本清单不强制。

### 5.4 含表结构变更时的额外动作

若本次发布包含 DDL（加列 / 改约束 / 建索引）：

1. **必须先做 5.2 的数据导出**（顺序不可反）；
2. 走 `managePgDatabase action=applyMigration`（DDL 不用 `execute`），新建一个 `cloudbase/migrations/<时间戳>_<说明>.sql`；
3. 文件里必须写明 `rollbackSql`（回滚 SQL），并在 `db/README.md` 或迁移文件注释里写清「回滚前要不要先清理数据」；
4. 回滚见 `ROLLBACK_RUNBOOK.md` 第三层。

---

## 六、踩坑速查（发布环节）

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 构建失败 `Local directory does not exist` | `buildPath` 忘了传，默认 `tcb hosting deploy dist /`，而暂存目录里没有 `dist/` 层 | 补 `buildPath="dist"`，deployCmd 会变成 `tcb hosting deploy . /` |
| 域名变了、前端全 403 | 用了 `manageHosting` 或换了 `serviceName` | 必须用 `manageApps` + 同一 `serviceName`；前端 `API_BASE` 与云函数 `ALLOWED_ORIGINS` 都要同步 |
| 部署报「当前未登录」 | MCP 登录态约一天过期 | 重新走设备码授权；第一个码没生效就换新码重试 |
| 改了代码线上没变 | 忘了重新部署（云函数 / 静态托管是两回事） | 云函数 `updateFunctionCode`；前端 `manageApps deployApp` |
| 云函数部署了但行为没变 | 部署的是 `cloudfunctions/` 根而非函数目录 / 忘了含改动文件 | 核对 `functionRootPath`；用 `ModTime` 晚于最后提交时间验证 |
| 业务日志排查 | 需要服务端原文 | `queryLogs(action="searchLogs")`，`queryString` 用 `request_id:"<id>"` 或 `log:"关键词"` |

---

## 七、相关文档

| 文档 | 用途 |
|---|---|
| `ROLLBACK_RUNBOOK.md` | 回滚手册（触发条件 + 三层回退 + 演练实测记录） |
| `skills/verify-project/SKILL.md` | 8 项自动检查的判据定义与排错速查 |
| `RUN.md` | 本地运行方式 + 线上验证清单 |
| `api-contract.md` | 接口契约（唯一依据，v1.9） |
| `db/README.md` | 建表 / 种子数据 / 5 组验证 SELECT |
| `TEST_CHECKLIST.md` · `TEST_EVIDENCE.md` | 测试清单与前后对照证据 |
