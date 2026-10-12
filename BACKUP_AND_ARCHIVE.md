# 代码永久保存 & 数据以备份为准 · 操作手册

> 建立于 2026-10-12（Day 27 收口）。适用对象：本项目自己。
> 配套工具：`tools/backup-tool.js`（导出 / 比对 / 还原 / 校验）。
> 备份落点：`.workbuddy/drill/`（被 `.gitignore` 忽略，不会上传）。

---

## 0. 一句话结论（先记住这两句）

| 对象 | 永久保存在哪 | 权威副本 |
| --- | --- | --- |
| **代码 / 文档 / 数据库定义** | **GitHub 仓库** `Panky-pan/Daily-Health-Log`（public，分支 `main`） | 远程仓库的 `main` 最新 commit |
| **业务数据（打卡记录 / 目标设置）** | **不上 GitHub**；存成 **JSON 备份文件** | **到期前导出的那份备份**（不是云数据库里的行） |

关键判断：**云数据库里的数据是易失的，备份才是准的。**
原因是本环境的资源额度按周期每月 3000 点发放，而 PostgreSQL 实例「存在即计费」——
按当前均速（约 200 点/天）**预计 2026-10-16 前后额度耗尽**，届时服务可能被停；
环境本身的到期日是 **2027-04-01 23:59:59**（`IsAutoRenew=false`，不会自动续）。
两种情况都会让库里的数据「只读不到、也拿不回来」。
所以：**要留下的数据，必须在额度/到期之前导出成备份文件，并以这份备份为准。**

---

## 1. 为什么数据不进 GitHub

1. 仓库是 **public（公开）** —— 任何人可见。
2. 数据是 **个人健康隐私**（体重、饮食、运动），且当前接口角色 `anon` **无鉴权**，
   本来就不该多留副本。
3. 数据会天天变，版本控制对它是负担，不是帮助。
4. `.gitignore` 已经把 `.workbuddy/`（含全部备份）排除，**默认就传不上去**——
   这是有意的设计，别去改它。

> 如果将来想把数据也做版本化：只能放到**单独的私有仓库**或**私有云盘**，
> 绝不要放进这个公开仓库。

---

## 2. 需要同步到 GitHub 的内容（白名单）

这些都是「代码」，应当在每次改动后 `commit` + `push`：

- **前端页面**：`welcome.html` · `index.html` · `history.html` · `trends.html` · `checkin.html` · `check.html`
- **前端资源**：`assets/css/style.css` · `assets/js/*.js`（`api-source.js` / `storage.js` / `today.js` / `checkin.js` / `welcome.js` / `calories.js` / `today` 等）
- **云函数**：`cloudfunctions/api-health/**`（`index.js` · `handlers/` · `lib/` · `repositories/` · `validators/` · `scf_bootstrap` · `package.json`）
- **数据库定义**：`db/schema.sql` · `db/seed.sql` · `db/README.md` · `cloudbase/migrations/**`
- **文档**：`PRD.md` · `TECH_DESIGN.md` · `api-contract.md` · `research.md` · `RELEASE_CHECKLIST.md` · `ROLLBACK_RUNBOOK.md` · `BACKEND_LAYERS.md` · `RUN.md` · `TEST_*` · `TRIAL_*` · `DATA_ISOLATION_PLAN.md` · `CLOUDBASE_RESOURCE_CHECK.md` · 本文件 · `AGENTS.md`
- **工具与配置**：`tools/backup-tool.js` · `.gitignore`

> `check.html`（检查台）可以留在仓库，但**部署到静态托管时不要带上它**（部署走 `.workbuddy/tmp/deploy-site/dist/` 的暂存法，天然排除）。

## 3. 绝不上传 GitHub 的内容（黑名单）

- `.workbuddy/**` —— 全部（记忆日志、`drill/` 备份、`tmp/` 部署暂存），已在 `.gitignore`
- `.env` / `.env.*`（除 `.env.example`）· `*.pem` / `*.key` / `secrets.*` / `config.secret.*`
- `node_modules/`
- **任何含真实打卡数据的 JSON 备份**
- 数据库连接串、密钥、token

提交前一定先看一遍：`git status`（逐行确认没有意外文件混进来）。

---

## 4. 备份存放与命名

### 4.1 存放位置

| 层级 | 位置 | 说明 |
| --- | --- | --- |
| 主副本 | `D:\Projects\Daily-Health-Log\.workbuddy\drill\` | 本地、gitignore、随手可查 |
| 副副本 | 个人云盘（OneDrive / 坚果云 / 微信「文件传输助手」等） | 防「本机磁盘坏了/项目文件夹被删」 |
| ❌ 禁止 | 本公开仓库 | 隐私 + 公开 |

> 只要主副本还只在这一台机器上，它就不算「永久」。**每周至少往云盘拖一份最新的。**

### 4.2 命名规范（从本文件起统一）

```
backup-YYYYMMDD-HHMM-<标签>.json
```

`<标签>` 取值约定：

| 标签 | 含义 |
| --- | --- |
| `full` | 常规全量（导出当刻的 checkins + settings） |
| `presweep` | 清空/大改数据**之前**的快照 |
| `pre-expiry` | 额度或环境**到期前**的基线备份（最重要的一份） |
| `dayN` | 某个任务日的快照 |

示例：`backup-20261012-1122-presweep.json`、`backup-20261016-0900-pre-expiry.json`

### 4.3 备份文件的内部结构（`export` 命令自动生成）

```json
{
  "exportedAt": "2026-10-12T03:25:50.770Z",
  "envId": "daily-health-log-d3eej7197499a30",
  "apiBase": "https://...tcloudbase.com",
  "source": "GET /api/checkins + GET /api/settings",
  "label": "full",
  "counts": { "checkins": 12, "settings_rows": 1 },
  "settings": { "goalExerciseMinutes": 30, "goalWaterMl": 2000, "startDate": "2026-09-21" },
  "checkins": [ { "date": "2026-09-21", "exerciseType": "慢跑", "...": "..." } ],
  "restoreNote": "恢复方式……"
}
```

**每份备份必须自带元数据**（时间、环境、条数），否则日后无法判断它是哪一刻的。

---

## 5. 比对方法：Day 27 备份 vs 当前库 vs 仓库代码

比对分**两条互不相干的线**，别混在一起看。

### 5.1 代码线 —— 用 Git（比的是「文件」）

```
git log --oneline -5
```
```
git status -s
```
```
git diff --stat HEAD origin/main
```

- `git status` 应为空（或只列你正要提交的改动）。
- `git diff --stat HEAD origin/main` **无输出 = 本地与远程完全一致**。
- 线上运行的是哪一版前端，看 `RELEASE_CHECKLIST.md` 记录的静态托管版本号（当前 `daily-health-log-011`）；
  云函数代码版本用 `manageFunctions queryFunctions` 看 `ModTime` 与仓库 `cloudfunctions/api-health/` 对齐。

### 5.2 数据线 —— 用备份工具（比的是「记录」）

```
node tools/backup-tool.js compare .workbuddy/drill/day27-backup-20261011-1630.json
```

输出会分三类告诉你差异：

- `✗ 仅备份有` = **库里缺、备份里有的日期**（数据丢了，需要重放补回）
- `+ 仅库里有` = 备份之后新记的日期（应当并入一份新备份）
- `~ 字段不同` = 同一天但内容不一样（逐字段列出「备份=… 库=…」）

> 2026-10-12 实跑结果：因当天已清空测试数据，输出为「备份 12 条 / 库 0 条」，
> 12 个日期全部落在「仅备份有」——这正说明**库里没有、备份里有，数据以备份为准**。

### 5.3 导出当前库（随时生成新备份）

```
node tools/backup-tool.js export --label full
```
```
node tools/backup-tool.js export --label pre-expiry --out .workbuddy/drill/backup-20261016-0900-pre-expiry.json
```

---

## 6. 还原方法：把备份装回库里

因为 **A7「批量导入」接口未实现**，还原只能**逐条重放**。用工具一条命令搞定：

1. 先空跑看清会写什么（不产生任何写入）：
   ```
   node tools/backup-tool.js restore .workbuddy/drill/day27-backup-20261011-1630.json --dry-run
   ```
2. 确认无误后真跑：
   ```
   node tools/backup-tool.js restore .workbuddy/drill/day27-backup-20261011-1630.json
   ```
3. 立刻回验：
   ```
   node tools/backup-tool.js compare .workbuddy/drill/day27-backup-20261011-1630.json
   ```
   看到「库里内容与备份一致 ✓」即还原成功。

工具内部做的事（等价于手工步骤）：

- `settings` → `PUT /api/settings`（body 只带 `goalExerciseMinutes` / `goalWaterMl`，**不带 `date`**）
- 每条记录 → `PUT /api/checkins/{date}`（body 为 11 个内容字段，**不带 `date`**）

注意事项：

- 重放是**覆盖式 upsert**：同一天若已有记录会被整条替换。
- 若库里还残留旧软删行，**先物理清空再重放**（避免出现重复日期、旧行干扰）。
- 新插入的记录 `id` 会重新分配（原 id 无法保留），这不影响业务。
- 还原前**先确认 MCP / 网络可用**（见风险 6）。

---

## 7. 验证清单

### A. 验证「代码已永久保存到 GitHub」

| 步骤 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| 1 | `git push -u origin main` | **自身输出**里出现 `xxx..yyy  main -> main`（别依赖 `git ls-remote`） |
| 2 | 打开 `https://api.github.com/repos/Panky-pan/Daily-Health-Log/commits/main` | 返回的 `sha` 前 7 位 == 本地 `git log --oneline -1` |
| 3 | 打开 `https://api.github.com/repos/Panky-pan/Daily-Health-Log/contents/tools` | 能看到 `backup-tool.js`（新文件确实在远程） |
| 4 | `git diff --stat HEAD origin/main` | 无输出 = 本地与远程树一致 |

### B. 验证「数据已由到期前导出的备份覆盖」

| 步骤 | 命令 / 动作 | 通过标准 |
| --- | --- | --- |
| 1 | `node tools/backup-tool.js verify <备份文件>` | 结论为「备份结构完整 ✓」，且 `exportedAt` 早于到期时刻 |
| 2 | `node tools/backup-tool.js compare <备份文件>` | 差异项都能解释（缺的=有意清空的，多的=新记录），或完全一致 ✓ |
| 3 | 备份文件同时存在于**本地 drill** 与**云盘副副本** | 两处都能打开、`counts` 一致 |

---

## 8. 本次执行记录（2026-10-12）

1. **清空测试数据**（执行于本手册之前）：
   - 清空前快照 → `.workbuddy/drill/backup-20261012-1122-presweep.json`
   - 执行 `DELETE FROM public.checkins;` + `DELETE FROM public.settings;`
   - 复核：`GET /api/checkins` → `{"ok":true,"data":{"items":[],"total":0}}`；`GET /api/settings` → `{"ok":true,"data":{"settings":null}}`
   - 结论：**两表 0 行**（注：自增序列未重置，首条新记录 id 从 4 开始，不影响业务）
2. **新增工具** `tools/backup-tool.js`，`export / verify / compare / restore --dry-run` 四路实测通过。
3. **代码归档**：本文件 + 工具 + 两份更新文档，已在本地提交为 commit **`accb7a1`**（4 文件 / +657 −38）。
4. **推送通道实况（必读）**：本次推送**只能在你本机的 Git Bash 里执行**。实测结论——沙箱环境到 GitHub 有两条路，**两条都通不了**：
   - `git push` → 代理**拦截 `github.com`**（`CONNECT tunnel failed, response 502`），直连又超时；
   - GitHub 连接器 API 写入 → **只读权限**（`403 Resource not accessible by integration`），建不了 tree/commit。

   而 `api.github.com` **读**是通的（HTTP 200），所以**推送完成后，可由沙箱远程核验**，不需要本机 git。

   本机执行（你已在 `D:\Projects\Daily-Health-Log` 目录下，直接跑这一条）：
   ```
   git push -u origin main
   ```
   看到输出里出现 `accb7a1..` 与 `main -> main` 即成功。

---

## 9. 风险与注意事项

1. **「有备份」≠「能还原」**：备份只是 JSON，还原要靠本工具的逐条重放。
   **导出后最好空跑一次 `restore --dry-run` 确认字段对得上**，才算真正可信。
2. **本地单点风险**：`.workbuddy/drill/` 只在这台机器；磁盘坏 = 备份全丢。
   → 必须另存一份到云盘，**不要**存到公开仓库。
3. **公开仓库红线**：提交前 `git status` 逐行看，**确认没有把 `.workbuddy/`、密钥、数据 JSON 混进去**。
   一旦误提交，GitHub 历史里会永久留存，需要立刻改密钥并清理历史。
4. **真正的到期风险是「额度」不是「日期」**：主风险是资源点 **~10-16 耗尽**（PG 占 98.7%），
   而不是 2027-04 的环境到期。**备份要趁现在做，别等。**
   额度用完体验版**不支持加购/按量付费** → 只能升级套餐或等周期重置（每月 1 号重置发放）。
5. **`curl` 200 ≠ 浏览器能打开**：测试域名有「页面访问提示」中间页，脚本能拿到 HTML 但人看不到。
   验证页面只能靠真人打开。接口层验证用 `curl GET` 是可靠的。
6. **MCP 登录态次日失效**：清库 / 还原 / 查询前先跑一次工具里的状态检查；过期需在浏览器完成设备码授权。
7. **删除是不可逆的**：本手册的数据清空是物理 `DELETE`，**执行前必须先导出快照**（本次已导出 `presweep`）。
8. **CLS 日志只留 7 天**：别指望用服务端日志回溯数据；**数据库状态比日志更硬**。
9. **`anon` 无鉴权**：接口链接绝不可外传；未来接入登录后，本手册的备份策略需重新评估。
10. **备份是快照，不是同步**：备份不会自动跟进新记录，**每次要留档时都要重新 `export` 一份**。
11. **推送只能在本机做**：自动化沙箱到 `github.com` 的两条写入通道都被挡住（代理拦截 + 连接器只读），所以「提交并推送到 GitHub」这一步**必须由你本机那条 `git push` 收尾**。别以为代码改了就等于上云了 —— **commit 只是本地的，push 才是永久的。**
12. **推送成功后要复核**：本机 `git push` 的输出、远程 `main` 的 commit、以及 `git diff --stat HEAD origin/main`（应为空）三处对齐，才算「已永久保存」（见 §7-A）。
