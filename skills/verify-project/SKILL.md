---
name: verify-project
description: Daily-Health-Log 每次发布前的自动回归检查。当用户说「发布前检查」「上线前跑一遍验证」「verify-project」「部署前自检」「发版前确认」时调用。逐项检查健康接口、读写接口往返、硬编码密钥、数据库与核心表，输出 PASS/FAIL + 证据，不允许模糊结论。
---

# verify-project · 发布前自动检查

## 何时用

- 改完前端或云函数、准备部署上线之前（**每次发布前必跑**）。
- 部署之后再跑一次（部署后验证，确认线上确实生效）。
- 排查「线上不对劲」时的第一站：先跑这个，用证据定位是哪一层出问题。

## 怎么调用

在对话里直接说：

> 跑一下 verify-project 做发布前检查

或

> 发布前检查

我会自动加载本 Skill 并执行：

```bash
C:/Users/starm/.workbuddy/binaries/node/versions/22.22.2-6/node.exe skills/verify-project/scripts/verify.js
```

可用参数：

| 参数 | 作用 | 什么时候用 |
|---|---|---|
| （无） | 完整检查，含写接口往返 + 自动清理 | 常规发布前 |
| `--skip-write` | 跳过写测试（线上数据冻结时用） | 不想动线上数据时 |
| `--json` | 额外输出机器可读 JSON | 需要把结果存档/比对时 |

## 检查项（每项：执行命令 + 怎么算通过）

> 全部判据基于「具体字段/具体字符串的比对」，不做「看起来正常」这类主观判断。

### 1. 健康接口 GET /api/health 【FAIL→阻断】

- **命令**：`curl -sS -w '\n[HTTP %{http_code}]' 'https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/health'`
- **通过判据（三条全中）**：HTTP `200`；`ok === true`；`service` 与 `time` 都是字符串且 `time` 以 `20` 开头（不是空串/占位）。
- **失败意味着**：云函数没部署、挂了、或路由被改坏。**必须停，不能发布。**

### 2. 读接口 GET /api/checkins?limit=3 【FAIL→阻断】

- **命令**：`curl -sS 'https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins?limit=3'`
- **通过判据（三条全中）**：HTTP `200` 且 `ok === true`；`data.items` 是数组；每条记录里文字字段（`exerciseType` / `meal*Text` / `meal*Tag`）的**空值必须是 `""` 而不是 `null`**（契约 2.6，返 null 前端会渲染成 "null kg"）；`date` 升序。
- **失败意味着**：读链路坏了，或空值约定被破坏。**阻断发布。**

### 3. 写接口往返 PUT → GET → DELETE 【FAIL→阻断】

- **命令**（脚本自动跑，等价手工命令）：
  ```bash
  curl -sS -X PUT -H 'Content-Type: application/json' -d '{"exerciseType":"慢跑","exerciseMinutes":30,"exerciseCalories":300,"mealBreakfastText":"","mealBreakfastTag":"","mealLunchText":"verify-project 冒烟","mealLunchTag":"普通","mealDinnerText":"","mealDinnerTag":"","weightKg":64.5,"waterMl":1500}' 'https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com/api/checkins/1999-01-01'
  ```
- **通过判据（三条全中）**：PUT 返回 `200` 且 `data.saved === true`；**GET 回读的 record 与写入内容逐字段一致（不一致字段数 = 0）**；DELETE 后 GET 回读 `record === null`（证明冒烟数据已清干净）。
- **为什么必须回读**：Day 23 的真实事故就是 PUT 报 500 / 写了没生效，只有回读才发现。只信 PUT 返回值 = 漏报。
- **为什么用 1999-01-01**：这个日期永远不会是真实打卡日，写完立刻删除，不污染 Panky 的真实数据（**动真实数据前必须先 GET 备份**是项目铁律）。
- **失败意味着**：写库链路坏了（曾因 PostgREST 部分唯一索引推断失效报 `DATABASE_42P10`）。**阻断发布。**

### 4. 代码与 Git 搜不到硬编码密钥 【FAIL→阻断】

- **命令**：
  ```bash
  git grep -nIE 'sk-[A-Za-z0-9]{16,}|AKID[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(APIKEY|API_KEY|SECRET_KEY|SECRETKEY|PASSWORD|PASSWD|TOKEN)\s*[=:]\s*["'"'"'][A-Za-z0-9_\-]{16,}["'"'"']'
  git log -S 'CLOUDBASE_APIKEY=' --oneline --all
  git ls-files .env
  ```
- **通过判据（三条全中）**：第一条无输出（工作区无真实密钥值）；第二条无输出（git 全历史无「带值的赋值」）；第三条无输出（`.env` 未被跟踪）。
- **为什么区分「值特征」和「变量名」**：`CLOUDBASE_APIKEY` 这个**变量名**在注释和文档里到处都是（合法），只有**赋了值的**才算泄露。别把变量名当误报。
- **失败意味着**：可能已泄露。**阻断发布**，先清密钥、改 git 历史或轮换凭证。

### 5. 数据库可连接 + 核心表存在 【FAIL→阻断】

- **命令**：`curl -sS '.../api/settings'` 与 `curl -sS '.../api/checkins?limit=1'`
- **通过判据**：`/api/settings` 返回 `200` 且 `data.settings.goalExerciseMinutes` 存在；`/api/checkins` 返回 `200` 且 `data.items` 是数组、`data.total` 是数字。两者都成立 = 云函数经 PG 网关连上了库，且 `checkins` / `settings` 两张核心表都存在、都能取到数据。
- **为什么不用 SQL 直查 information_schema 当主判据**：云函数用 `anon` 角色连库，而 MCP 的 PG 工具默认走 `cloudbase_postgres` 角色——**角色不同**，「MCP 能查到」不等于「线上 anon 能查到」。用线上接口本身当探针最可信。
- **SQL 侧对账（可选，需 MCP 登录态）**：
  ```sql
  SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('checkins','settings');
  ```
- **失败意味着**：连库失败（500 `DB_ERROR`）或表被删。**阻断发布。**

### 附加项（不阻断发布，但会在结果里显示）

| ID | 检查 | 通过判据 |
|---|---|---|
| A-BASE | 前端接口基地址与线上一致 | `assets/js/api-source.js` 的 `API_BASE` === 脚本使用的 BASE（防换域名后漏改） |
| B-SYNTAX | 关键 JS 语法检查 | `node --check` 全部通过（语法错会让页面白屏但接口全好） |
| C-WRITE | 写权限通道正常 | PATCH 不存在日期返回 `404`（说明进到业务层，anon 未被误收紧；若 500 则可能是 42501 权限被收） |

## 输出格式

逐项一行，**格式固定**：

```
[PASS ] 1-A1 健康接口 GET /api/health
        证据: HTTP 200，body={"ok":true,"service":"daily-health-log-demo","time":"2026-10-10 20:30:00"}
```

末尾给出汇总：`结论: PASS N / FAIL M / SKIP K`，以及是否可发布。

**禁止**出现「看起来正常」「基本没问题」「应该没事」这类表述：状态只有 PASS / FAIL / SKIP 三种，FAIL 必须附可复现命令。

## 排错速查（FAIL 时看这里）

| 失败项 | 最可能原因 | 怎么办 |
|---|---|---|
| 1-A1 FAIL | 云函数没部署 / 网关路由坏了 | 重跑部署：`manageFunctions action=updateFunctionCode, functionName=api-health, functionRootPath="D:/Projects/Daily-Health-Log/cloudfunctions"` |
| 3-A6 FAIL `DB_ERROR` 500 | PostgREST 部分唯一索引推断失效 / anon 缺写权限 | 查 CLS 日志按 request_id 拿原文；`DATABASE_42P10` → 检查 repository 是否退回 `onConflict` 写法；`DATABASE_42501` → 补 GRANT |
| 3-A6 FAIL（写入成功但回读不一致） | 字段映射（snake↔camel）出错 | 查 `lib/mappers.js` |
| 4-SEC FAIL | 密钥进了代码/历史 | 移除 + 轮换凭证，勿只删文件 |
| 5-DB FAIL | 库连接失败 / 表被删 | 查 `lib/db.js` 的 `database: "public"` 是否还在（漏了会 406 PGRST106） |
| C-WRITE FAIL 500 | anon 写权限被收回 | 补 `GRANT INSERT, UPDATE ON public.checkins TO anon;` + 序列 GRANT（**注意顺序，别把自己锁死**） |

## 实际运行记录（含首轮修正）

### 第一次运行：找出 3 个脚本缺陷

首次跑发现**3 处问题**，全部是脚本自身缺陷（不是项目问题），已修正：

| 缺陷 | 类型 | 现象 | 修正 |
|---|---|---|---|
| `PROJECT_ROOT` 少算一层目录 | 假失败 | 所有本地文件检查都报 `ENOENT ...\.workbuddy\assets\js\api-source.js` | 路径上溯改为 4 层（scripts→verify-project→skills→.workbuddy→root） |
| 语法检查用 `spawnSync(node, ["--check"])` | 假失败 | 本机 EBUSY（无法再起 node 子进程），退出码恒为 `null`，**5 个完好文件全被判 FAIL** | 改用 `new Function(src)` 进程内编译，不再依赖子进程 |
| 密钥检查用 `git grep` | 假失败 | `--exclude-dir` 对 `.workbuddy` 这类点目录不可靠，会扫到技能/文档误报 | 改为自己遍历 + 正则，明确跳过 `node_modules`/`.git`/`.workbuddy` |
| `runAndPrint` 忘写 `await` | 重复+漏报 | B-SYNTAX 印两遍、C-WRITE 差点被跳过 | 调用一律 `await`；并加「防空转」保护：某项没产出结果就报 `SELF-CHECK FAIL` |

### 第二次运行：8 项全 PASS

```
[PASS ] 1-A1    健康接口 GET /api/health
[PASS ] 2-A4    读接口 GET /api/checkins?limit=3
[PASS ] 3-A6    写接口往返 PUT→GET→DELETE
[PASS ] 4-SEC   代码与 Git 搜不到硬编码密钥
[PASS ] 5-DB    数据库可连接 + 核心表存在 (checkins / settings)
[PASS ] A-BASE  前端接口基地址与线上一致
[PASS ] B-SYNTAX 关键 JS 语法检查（编译期）
[PASS ] C-WRITE 写权限通道正常（anon 未被误收紧）
结论: PASS 8 / FAIL 0 / SKIP 0  ✅ 全部通过，可以发布
```

变体验证：`--skip-write` 下 3-A6 正确显示为 `SKIP`（结论 PASS 7 / FAIL 0 / SKIP 1），退出码仍是 0。

### 第三次：故意弄坏，证明它**不会虚报通过**（Day 25 核心验证）

一个只会说「全部通过」的检查器等于没检查。所以每项能力都做了反向验证：**故意制造故障 → 必须 FAIL → 还原 → 必须 PASS**。

| # | 目标项 | 故意制造的问题 | 期望 | 实测 |
|---|---|---|---|---|
| T1 | `4-SEC` | 在 `api-source.js` 注入一行假密钥赋值（形状与真实密钥一致） | FAIL + 指出文件行号 | **FAIL**，命中 `api-source.js:36`，还原后回到 **PASS** |
| T2 | `1-A1` | 给健康接口发 `POST`（方法不对） | 非 200 → FAIL | **405** `METHOD_NOT_ALLOWED` → 判 FAIL |
| T3 | `3-A6` | 写接口传体重 `500 kg`（超契约上限） | 非 200 → FAIL | **400** 「体重要填 30~200 kg 之间的数」→ 判 FAIL |

**这一步逮到了检查器自己的两个真缺陷**（比误报危险得多的是**漏报**）：

1. **漏报（严重）**：最初密钥规则写成「固定变量名列表 + 带值」，注入的 `var DEBUG_KEY = "abcdef...(32位)";` **一条都没报**（命中=0，仍判 PASS）——因为 `DEBUG_KEY` 不在词表里，这就是**虚报通过**。
   → 修法：不再枚举变量名，改成**按「赋值形状 + 值像不像密钥」判定**（变量名含 KEY/SECRET/TOKEN/PASSWORD 等 **且** 值 ≥16 位、含字母+数字、不是 UUID）。
2. **误报（放宽后立刻冒出来）**：新规则把 `tagKey: 'mealBreakfastTag'`（前端字段映射表）和文档里的 UUID（requestId 证据）都当成了密钥。
   → 修法：加「值必须像密钥」约束（含字母+数字、排除 UUID 形状），3 个误报全部消除，注入行仍被精确命中。

**结论：先漏报 → 修 → 再误报 → 再修，最终「有故障必 FAIL、无故障不误报」都验证过。** 这正是必须真跑一遍、不能只写完就算的原因。

### 数据安全复验

两轮运行的冒烟日期 `1999-01-01` 均已清理，线上 `GET /api/checkins/1999-01-01` 返回 `record:null`；真实记录完整，`2026-10-06`（曾误删过的那天）原值未变。T1 的注入只发生在文件层面，测试后已 `diff` 逐字节确认工作区恢复原状（`git status` 无改动）。

### 已知限制（诚实标注，不掩盖）

- **沙盒里 `git` 可能不可用**（本项目环境已知问题：直接调 git 会 command not found）。此时 4-SEC 会打印「⚠️ git 不可用，历史侧未真正校验」——**这条 PASS 只覆盖了工作区扫描**，历史侧没真跑。要完整校验请在修好 PATH 的终端里手工跑 `git log -S 'CLOUDBASE_APIKEY=' --oneline --all`。
- 检查 5 用接口当探针（角色可信），**未直连 SQL 校验表结构**；需要时按上面 SQL 侧对账命令补跑（需 MCP 登录态）。
- 写往返还 **软删除**了冒烟行（`is_deleted=true`），不是物理删除——这是 A9 的设计（保留历史），不影响业务可见性。

## 检查项来源（本项目真实踩过的坑）

本清单不做通用模板，每一项都对应一次真实事故：

1. **健康接口**：区分「服务挂了」和「库挂了」（`handlers/health.js` 注释：不碰数据库）。
2. **写往返**：Day 23 A6 写入 500（`DATABASE_42P10`，部分唯一索引推断失效）——只信 PUT 返回值会漏报。
3. **空值 `""`**：契约 2.6，history.js 用 `=== ''` 判断，返 null 渲染出 "null kg"。
4. **密钥分「值/变量名」**：2026-10-08 安全审计的判定方法，避免把变量名当泄露。
5. **数据库连通用线上接口当探针**：`anon` 与 MCP 的 `cloudbase_postgres` 角色不同，「MCP 能查」≠「线上能读」。
6. **基地址一致性**：`manageHosting` 曾换域名，前端 `API_BASE` 会与线上不一致。
7. **语法自检**：Node vm 沙箱在语法错时静默失败，页面白屏但接口全好。
8. **写权限通道**：anon 写权限曾被误收，页面保存报 42501。

## 文件结构

```
skills/verify-project/            # 项目级 Skill，随仓库提交（可直接看到、可复用）
├── SKILL.md            # 本文件：何时用、怎么调、检查项与判据
└── scripts/
    └── verify.js       # 可执行检查脚本（Node，零依赖）
```

> **为什么放在根目录 `skills/` 而不是 `.workbuddy/skills/`**（2026-10-10 Day 25 拍板）：
> `.gitignore` 把 `.workbuddy/` 整个忽略了，放在那里**进不了 git**，无法满足「Skill 文件已入库」。
> 放到根目录后随仓库一起走，换台电脑 clone 下来就能用。
> 若要变成**跨项目**通用技能，把整个 `verify-project/` 复制到 `C:/Users/starm/.workbuddy/skills/` 即可。
