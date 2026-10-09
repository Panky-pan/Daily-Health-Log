# 核心流程测试清单 · Daily-Health-Log

> 生成日期：2026-10-09（Day 23）　环境：线上（ap-shanghai / `daily-health-log-d3eej7197499a30`）
> 适用链路：**打开检查台 → 读取 plan_days/checkins → 写入打卡 → 刷新确认 → 修改 → 删除**
> 术语对照：课程案例 `plan_days` = 本项目 `settings` 表（A2/A3）；`checkins` = 本项目 `checkins` 表（A4~A10）。
> 本次执行结论：**发现并修复 1 个 Bug（A6 写入 500），修复后同一清单全量重跑通过，前后证据见 TEST_EVIDENCE.md。**

---

## 一、完整链路测试清单（9 步）

每步给出：操作 → 预期。本次实测修复前 / 修复后结果附在每行末尾。

| # | 步骤 | 操作 | 预期 | 修复前 | 修复后 |
|---|------|------|------|--------|--------|
| 1 | 打开检查台 | 浏览器开 `check.html`（或直接 GET `/api/health`） | A1 返回 200 `{ok:true,service,time}` | 200 ✓ | 200 ✓ |
| 2 | 读取 plan_days | GET `/api/settings` | 200，`{goalExerciseMinutes,goalWaterMl,startDate}` | 200 ✓ | 200 ✓ |
| 3 | 读取 checkins | GET `/api/checkins`（检查台带 `?limit=30`） | 200，`items` 升序、空值是 `""` 不是 null | 200 ✓ | 200 ✓ |
| 4 | **写入打卡** | PUT `/api/checkins/{date}`（11 字段全量） | 200 `{saved:true,isNew,record}`；新日期 `isNew:true` | **500 ✗** | 200 ✓ |
| 5 | 刷新确认（单日） | GET `/api/checkins/{date}` | 200，`record` 与写入内容逐字段一致 | record:null（没写进去）| 200 ✓ |
| 6 | 刷新确认（列表） | GET `/api/checkins?limit=5` | 新日期出现在列表末尾 | 不出现 | 出现 ✓ |
| 7 | 修改 | PATCH `/api/checkins/{date}`（如 `{"weightKg":66}`） | 200 `{patched:true}`；只改指定列，其余原样 | 404（级联） | 200 ✓ |
| 8 | 删除 | DELETE `/api/checkins/{date}` | 200 `{date,deleted:true}`（软删除，打标记） | 404（级联） | 200 ✓ |
| 9 | 删除后确认 | GET `/api/checkins/{date}` | 200 + `record:null`（业务上「删了就没」） | record:null | 200 ✓ |
| 附 | 恢复 | POST `/api/checkins/{date}/restore` | 200，回恢复后的完整记录 | 404 | 200 ✓ |

## 二、关键语义用例（5 项）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| S1 | 重复 PUT 同一天 | `isNew:false`（覆盖非新建） | ✓ |
| S2 | **覆盖清列**：PUT 只带 `{"waterMl":1800}` | 其余字段全部变 `""`（契约 4.7 全量覆盖，缺的写 null） | ✓ |
| S3 | 同一天 DELETE 两次 | 第一次 200；第二次 404「删不了」 | ✓ |
| S4 | restore 没被删过的日期 | 404「不用恢复」 | ✓ |
| S5 | 覆盖后 created_at 保持 | SQL 对照：`created_at`=首次插入时刻 ≠ `updated_at` | ✓ |

> S2 是修复方案的**最大风险点**（新 UPDATE 路径的 null 会不会被 SDK 剥掉），实测 null 正常落库，覆盖语义完整保留。

## 三、刁钻输入用例（10 项）

| # | 用例 | 预期 | 结果 |
|---|------|------|------|
| E1 | PUT 空请求体 `{}` | 400「这一天还什么都没填，先记一项再保存吧」 | ✓ |
| E2 | PUT 超长文本（101 字） | 400「一句话就好，100 字以内」 | ✓ |
| E3 | PUT 非法运动类型（游泳） | 400 枚举校验 + 完整枚举列表 | ✓ |
| E4 | PUT 体重两位小数 65.55 | 400「体重最多填一位小数」 | ✓ |
| E5 | PATCH 空请求体 `{}` | 400「至少要改一个字段」 | ✓ |
| E6 | PATCH / DELETE 没记录的日期 | 404 + 中文提示 | ✓ |
| E7 | A4 非法参数（limit=0 / limit=abc / from 格式错） | 400 + 对应中文 | ✓ |
| E8 | 白名单外 Origin | 403「这个来源不在允许名单里」 | ✓ |
| E9 | 不存在的路径 / 路径对方法错 | 404 / 405 | ✓ |
| E10 | **快速连点**：同一新日期并行两个 PUT | 两个都 200；库里恰好 1 条可见行，无重复；后者 `isNew:false` | ✓ |

---

## 四、Bug 档案：A6 写入 500（发现 → 定位 → 修复 → 回归）

### 4.1 发现

按清单第 4 步对空日期 `2026-10-08` 执行 PUT：

```
{"ok":false,"error":{"code":"DB_ERROR","message":"记录没存上，稍后再试一次"}}   [HTTP 500]
```

后续步骤级联失败（没写进去 → PATCH/DELETE 全 404）。

### 4.2 定位（原因排序 → 每个原因的验证方法）

按可能性从高到低排查，前三个候选原因全部实测排除：

| 排序 | 候选原因 | 验证方法 | 结论 |
|------|----------|----------|------|
| 1 | anon 写权限被收回（历史发生过） | 查 `information_schema.table_privileges` + 序列 grants | ❌ 排除：anon 有 INSERT/UPDATE/SELECT/DELETE，序列有 USAGE |
| 2 | 软删迁移没生效（索引/列缺失） | 查 `pg_indexes` + 全表 `is_deleted` 列 | ❌ 排除：`checkins_user_date_active_key`（部分唯一索引）在位 |
| 3 | 线上跑的不是最新代码（`[row]` 修复没部署） | 云端日志找 Day 23 请求日志特征 + 函数 ModTime | ❌ 排除：日志里有 Day 23 才加的请求行，部署即最新 |
| 4 | **PostgREST 谓词推断失效（真根因）** | CLS 按 request_id 捞 `sendDbError` 记下的报错原文 | ✅ 确认，见下 |

**报错原文**（云端日志 request_id `dc730d01-d21c-4a01-84a6-974b394e57e6`）：

```
code: 'DATABASE_42P10'
message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification'
```

**根因解释**：软删除把唯一约束换成了部分唯一索引 `(user_id, date) WHERE NOT is_deleted` 后，
`ON CONFLICT (user_id, date)` 必须带上谓词才匹配得到它，而谓词靠 PostgREST 从请求体
`is_deleted: false` 推断。旧代码注释声称「改成 `[row]` 数组后写入正常」，实测**两种写法推断都不生效**
——推断依赖底层 SDK 与网关 PostgREST 的版本行为，太脆。软删迁移（10-07 22:04）之后，
A6 写路径实际上从未成功过（10-07 21:36 的成功写入发生在迁移之前，走的还是旧的全表唯一约束）。

### 4.3 修复方案

`cloudfunctions/api-health/repositories/checkins.repository.js` 的 `saveCheckin`：
**弃用 `.upsert(..., {onConflict})`，改为显式二段式**，对外行为与契约 4.7 完全一致：

1. 先 `findByDate`（带 visibleOnly）找当天可见行；
2. 有 → 按 `id` 整条 UPDATE（`created_at` 不在 SET 里，自然保持；顺带 `eq("user_id")` 防御）；
3. 无（从未写过 / 已被软删）→ INSERT 新行，旧行留库作历史（「复活」语义）；
4. INSERT 撞 23505（并发抢先插了同一天）→ 重查转覆盖重试，兜住「快速连点」。

handler 层（isNew 判断、响应形状）零改动；PATCH/DELETE/restore 路径零改动。

### 4.4 回归验证清单（修复后同一清单重跑）

- 完整链路 9 步：**9/9 通过**（修复前 1/9，步骤 4 起级联失败）
- 关键语义 5 项：**5/5 通过**（含覆盖清列、created_at 保持）
- 刁钻输入 10 项：**10/10 通过**（含并发快速连点）
- SQL 侧：复活结构正确（10-08 两行：1 历史软删 + 1 可见）、并发后无重复行、全表可见行数符合预期
- 清理：测试数据（10-07 / 10-08 共 3 行）已硬删，库恢复测试前状态（10 行，最新 2026-10-06 用户真实数据）
- 结论：**修复未引入新问题**

---

## 五、怎么用这份清单重跑

1. 挑一个**没有记录**的日期（检查台 `check.html` 的日期提示会告诉你哪天空着；接口侧可用 GET `/api/checkins/{date}` 确认 `record:null`）。
2. 按第一节 9 步顺序执行；页面上对应检查台的四张卡（写入 / 局部修改 / 删除），或直接 curl（命令见 TEST_EVIDENCE.md 开头）。
3. 每步对照「预期」列；任何一步不符，按 `现象 / 复现步骤 / 报错原文 / 已尝试动作` 反馈。
4. 语义 5 项与刁钻 10 项作为加练：重点 S2（覆盖清列）和 E10（快速连点）。
5. 测试完把测试日期的记录删掉（删除即软删，页面上就看不见了）。
