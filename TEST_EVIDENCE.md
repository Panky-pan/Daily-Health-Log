# 测试证据 · 前后对照（2026-10-09）

> 配套清单：TEST_CHECKLIST.md　环境：线上 ap-shanghai
> 测试日期：2026-10-08（链路主用例）、2026-10-07（并发用例）——两天当时均无记录，测试数据已清理。
> ⚠️ 库里有用户真实打卡数据（如 2026-10-06），所有写/删测试前先 GET 确认目标日期无记录，测试后清理。

## 0. 复现命令（可整段贴终端）

```bash
BASE="https://daily-health-log-d3eej7197499a30-1499041418.ap-shanghai.app.tcloudbase.com"
D="2026-10-08"   # 换成任意无记录的日期
# ① 写入　② 读单日　③ 读列表　④ PATCH 改体重　⑤ 读确认　⑥ DELETE　⑦ 读确认删了　⑧ restore　⑨ 读确认恢复
curl -sS -w "\n[%{http_code}]\n" -X PUT "$BASE/api/checkins/$D" -H "Content-Type: application/json" \
  -d '{"exerciseType":"慢跑","exerciseMinutes":30,"exerciseCalories":300,"mealLunchText":"链路测试","mealLunchTag":"普通","weightKg":64.5,"waterMl":1500}'
curl -sS -w "\n[%{http_code}]\n" "$BASE/api/checkins/$D"
curl -sS -w "\n[%{http_code}]\n" "$BASE/api/checkins?limit=5"
curl -sS -w "\n[%{http_code}]\n" -X PATCH "$BASE/api/checkins/$D" -H "Content-Type: application/json" -d '{"weightKg":66}'
curl -sS -w "\n[%{http_code}]\n" "$BASE/api/checkins/$D"
curl -sS -w "\n[%{http_code}]\n" -X DELETE "$BASE/api/checkins/$D"
curl -sS -w "\n[%{http_code}]\n" "$BASE/api/checkins/$D"
curl -sS -w "\n[%{http_code}]\n" -X POST "$BASE/api/checkins/$D/restore"
curl -sS -w "\n[%{http_code}]\n" "$BASE/api/checkins/$D"
```

---

## 一、修复前证据（BEFORE，2026-10-09 10:47）

### 1.1 链路原始响应

| 步骤 | 请求 | HTTP | 响应 |
|------|------|------|------|
| 1 | PUT `/api/checkins/2026-10-08` | **500** | `{"ok":false,"error":{"code":"DB_ERROR","message":"记录没存上，稍后再试一次"}}` |
| 2 | GET `/api/checkins/2026-10-08` | 200 | `{"ok":true,"data":{"record":null}}` ← 没写进去 |
| 3 | GET `/api/checkins?limit=5` | 200 | 最新到 2026-10-06，无 10-08 |
| 4 | PATCH 同日期 | 404 | `{"code":"NOT_FOUND","message":"2026-10-08 那天没有打卡记录，先去打卡页建一条再改"}` |
| 6 | DELETE 同日期 | 404 | `{"code":"NOT_FOUND","message":"2026-10-08 那天没有打卡记录，删不了"}` |
| 8 | POST `.../restore` | 404 | `{"code":"NOT_FOUND","message":"2026-10-08 这天没有被删掉的记录，不用恢复"}` |

链路在步骤 1 断裂，2~9 全部级联。

### 1.2 真实报错原文（云端 CLS 日志，request_id `dc730d01-d21c-4a01-84a6-974b394e57e6`）

```
[api-health] 2026-10-09T02:49:28.356Z PUT /api/checkins/2026-10-08 → 500 (175ms)
[api-health] PUT /api/checkins 写库 访问数据库失败: {
  code: 'DATABASE_42P10',
  message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  requestId: '42b1dd4e-7b22-43c3-84ea-ab82b0878d6f'
}
```

### 1.3 排除性证据（SQL 实测）

- 权限：`information_schema.table_privileges` → anon 有 `INSERT / UPDATE / SELECT / DELETE`；
  序列 `checkins_id_seq` → anon 有 `USAGE / SELECT / UPDATE`。**权限不是原因。**
- 索引：`pg_indexes` →
  `CREATE UNIQUE INDEX checkins_user_date_active_key ON public.checkins USING btree (user_id, date) WHERE (NOT is_deleted)`。**索引在位，不是原因。**
- 部署：云端日志含 Day 23 才加入的请求日志行；函数 ModTime 2026-10-09 10:43:10（> 最后提交 10:39）。**部署即最新，不是原因。**

---

## 二、修复后证据（AFTER，2026-10-09 10:58~11:09，同一清单重跑）

### 2.1 完整链路 9/9 通过

| 步骤 | 请求 | HTTP | 关键响应 |
|------|------|------|----------|
| 1 | PUT（同 1.1 的请求体） | 200 | `{"saved":true,"isNew":true,"record":{...全字段正确}}` |
| 2 | GET 单日 | 200 | record 与写入逐字段一致 |
| 3 | GET `?limit=5` | 200 | `2026-10-08` 出现在列表末尾 |
| 4 | PATCH `{"weightKg":66}` | 200 | `{"patched":true,"record":{...weightKg:66，其余字段原样}}` |
| 5 | GET 单日 | 200 | weightKg=66，其余不变 |
| 6 | DELETE | 200 | `{"date":"2026-10-08","deleted":true}` |
| 7 | GET 单日 | 200 | `record:null` |
| 8 | POST restore | 200 | `{"restored":true,"record":{...weightKg:66}}`（内容回来了） |
| 9 | GET 单日 | 200 | record 与删除前一致 |

### 2.2 关键语义 5/5 通过

- **S1** 重复 PUT：`isNew:false`，响应为覆盖后的新内容。
- **S2 覆盖清列**：PUT 只带 `{"waterMl":1800}` → 回读 `exerciseType:""、weightKg:""、mealLunchText:""... waterMl:1800`。
  （修复方案最大风险点：UPDATE 路径的 null 落库行为，实测正常清列。）
- **S3** 重复 DELETE：第一次 200，第二次 404「删不了」。
- **S4** restore 未删日期（2026-10-06）：404「不用恢复」。
- **S5** created_at 保持：见 2.4 SQL。

### 2.3 刁钻输入 10/10 通过

| 用例 | 实测 |
|------|------|
| E1 PUT `{}` | 400 `VALIDATION_ERROR`「这一天还什么都没填，先记一项再保存吧」 |
| E2 超长文本 101 字 | 400「一句话就好，100 字以内」field:mealLunchText |
| E3 非法运动类型 | 400「运动类型只能是：散步 / 慢跑 / 跳绳 / 骑行 / 力量训练 / 瑜伽」 |
| E4 体重 65.55 | 400「体重最多填一位小数」 |
| E5 PATCH `{}` | 400「至少要改一个字段」 |
| E6 PATCH/DELETE 无记录日期 | 404 中文 |
| E7 limit=0 / limit=abc / from=2026/01/01 | 400，三条 message 各自正确 |
| E8 Origin: https://evil.example.com | 403「这个来源不在允许名单里」 |
| E9 未知路径 / 错误方法 | 404 / 405 |
| **E10 并行双 PUT 同一新日期** | A:200 `isNew:true`，B:200 `isNew:false`；回读恰好 1 条可见记录（B 的内容），**无重复行、无 500** |

### 2.4 SQL 侧证据（清理前）

```
id=36  2026-10-08  is_deleted=true   慢跑 1500   ← 快速验证阶段的行，重置删除后留作历史（复活语义）
id=37  2026-10-08  is_deleted=false  (空) 1800  ← 回归链路插入的新行
       created_at = 2026-10-09 11:06:21（首次插入）  updated_at = 2026-10-09 11:07:16（末次覆盖）
       → created_at 保持 ✓（S5）
id=38  2026-10-07  is_deleted=false  散步 2000   ← 并发用例胜者，该日期仅此一行（E10 无重复 ✓）

全表：total=13，可见 12，软删 1（= 原始 10 行 + 10-07/10-08 测试行各 1 + 历史软删 1）
```

### 2.5 清理确认（库恢复测试前状态）

```
DELETE FROM public.checkins WHERE date IN ('2026-10-07','2026-10-08')  → 影响 3 行
清理后：rows_left=10，earliest=2026-09-21，latest=2026-10-06（用户真实数据未动）
接口侧：GET /api/checkins total=10；GET 10-07 / 10-08 均 record:null
```

### 2.6 修复改动

- 文件：`cloudfunctions/api-health/repositories/checkins.repository.js`（仅 `saveCheckin` 函数及其注释）
- 方式：`.upsert(..., {onConflict:"user_id,date"})` → 显式二段式（findByDate → 按 id UPDATE / INSERT，23505 并发兜底）
- 部署：manageFunctions `updateFunctionCode`，2026-10-09 10:55 前后
- 其余接口（A2/A3/A4/A5/A8/A9/A10）代码零改动，回归全部通过 = 未引入新问题

---

## 三、Day 24 复盘证据（2026-10-09 15:31~15:55，教学复盘：真复现 → 排除法定位 → 恢复修复 → 回归）

> 目的：把修复版临时撤下、装回旧版代码，让 Bug 在 F12 里真实复现一次，全程亲手重走四步。

### 3.1 复现（BEFORE，旧版代码部署后）

- 部署：`git show 69262ca:...checkins.repository.js` 取回修复前旧版 → `updateFunctionCode` 部署
- curl 实测：`PUT /api/checkins/2026-10-24` → **500** `{"ok":false,"error":{"code":"DB_ERROR","message":"记录没存上，稍后再试一次"}}`
- 浏览器实测（Panky 的 F12 截图 1）：控制台红色报错 `PUT https://...tcloudbase... 500 (Internal Server Error)`（来源 api-source.js:24），地址栏可见；页面提示「云端暂时连不上…已先存本机 √」（本地兜底生效，数据未丢）

### 3.2 定位：四嫌疑现场重跑

| 嫌疑 | 验证手段 | 现场结果 | 结论 |
|------|----------|----------|------|
| 权限（42501 特征） | 查 `information_schema.table_privileges` | anon 有 INSERT/UPDATE/SELECT/DELETE 四项 | 排除 |
| 索引缺失（42P10 特征） | 查 `pg_indexes` | `checkins_user_date_active_key` 在，但带 `WHERE (NOT is_deleted)`（部分唯一索引） | 未排除，升级为头号嫌犯 |
| 部署未生效 | 日志特征行 + ModTime | （Day 23 已验证） | 排除 |
| SQL/网关层 | CLS 搜 `DATABASE_42P10` | 4 条命中，含 Panky 浏览器那次 `request_id 12390bba`（15:39:06）与 curl 那次（15:35:04） | **定罪** |

### 3.3 恢复修复版并验证（AFTER）

- `git restore` 恢复工作区到 `4737255`（与修复版逐字节一致，grep 确认注释外无 onConflict 调用）→ 重新部署
- `PUT /api/checkins/2026-10-24` → **200** `isNew:true`，GET 读回逐字段一致
- 浏览器（Panky 的 F12 截图 2）：保存成功，控制台零报错（「未检测到任何问题」），真实打卡（瑜伽 15 分钟 / 三餐 / 56.2kg / 2000ml）同步上云——`GET /api/checkins/2026-10-09` 返回该记录实锤

### 3.4 回归（同一清单重跑）

- 链路 9/9：PUT 覆盖（`isNew:false`，整条覆盖生效）✓ GET ✓ PATCH 改体重（64.5→66，其余字段原样）✓ DELETE 软删 ✓ GET null ✓ restore ✓ GET 恢复 ✓
  （首跑 PUT 用了非法类型「快走」→ 400 校验拒绝，属校验逻辑正常工作，换合法值后通过）
- 无新问题引入：本次代码与 Day 23 回归时完全一致（`git restore` 至同一条提交），部署即该版本
- 清理：`DELETE FROM public.checkins WHERE date='2026-10-24'` → 影响 1 行；库回 **total=11**（9 条 seed + 真实记录 10-06 / 10-09），测试数据零残留
