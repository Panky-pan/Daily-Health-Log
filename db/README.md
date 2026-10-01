# db/ · 数据库脚本与操作手册

> 环境：CloudBase PostgreSQL，环境 ID `daily-health-log-d3eej7197499a30`
> 默认 schema：`public`　执行角色：`cloudbase_postgres`
> 字段与约束的唯一依据：`api-contract.md` 第三节（本目录的 SQL 就是照它写的）

## 目录里有什么

| 文件 | 作用 | 什么时候跑 |
|---|---|---|
| `schema.sql` | 建 `checkins` / `settings` 两张表 | 第一次建表；或要重建表结构时 |
| `seed.sql` | 灌 1 条设置 + 9 条示例打卡数据 | 建完表之后；或想把数据重置回示例状态时 |

两个脚本都**可重复执行**：`schema.sql` 先 DROP 再建，`seed.sql` 先清空再插入。跑几遍结果都一样（连每行的 id 都相同）。

---

## 一、在控制台执行

### 准备：进 SQL 编辑器

1. 浏览器打开云开发控制台 `https://tcb.cloud.tencent.com`，登录后选中环境 `daily-health-log-d3eej7197499a30`
2. 左侧菜单点「**数据库**」
3. 找到「**SQL 编辑器**」（PG 模式的 SQL 执行入口），点进去
4. 进去后不用改连接设置，默认就是 `public` schema

> 找不到 SQL 编辑器就走 DMC 路线：数据库 → 数据库设置 → 账号管理（先创建一个账号 + 密码）→ 点「数据库管理」按钮 → 在弹出的 DMC 页面用刚创建的账号登录 → 选「**SQL 窗口**」。
> 两条路线效果一样，DMC 多一步建账号。

### 第 1 步：建表

1. 用编辑器打开 `db/schema.sql`
2. **全选复制**（Ctrl+A → Ctrl+C），整段粘进 SQL 编辑器的输入框
3. 点「执行 / 运行」

**预期结果**：没有红色报错。可能看到几条 NOTICE，那是正常的（比如 `table "checkins" does not exist, skipping` —— 这是 `DROP TABLE IF EXISTS` 在表不存在时的正常提示，不是错误）。

**如果报错**：

| 报错 | 原因与处理 |
|---|---|
| 编辑器提示"一次只能执行一条语句" | 把脚本按 `-- ----` 分隔的段落拆开，一段一段执行，顺序不能乱 |
| `permission denied for schema public` | 当前执行身份权限不够 → 改走 DMC 路线，用自己创建的账号登录 |
| `syntax error at or near "..."` | 多半是复制时漏了字符（尤其中文注释行的引号），重新整段复制一次 |

### 第 2 步：灌示例数据

1. 用编辑器打开 `db/seed.sql`
2. 全选复制，粘进 SQL 编辑器
3. 点「执行 / 运行」

**预期结果**：三行输出，一行对应一条语句——

| 语句 | 预期显示 |
|---|---|
| `TRUNCATE TABLE ...` | `TRUNCATE TABLE` |
| `INSERT INTO settings ...` | `INSERT 0 1`（插了 1 行） |
| `INSERT INTO checkins ...` | `INSERT 0 9`（插了 9 行） |

**如果报错**：

| 报错 | 原因与处理 |
|---|---|
| `permission denied: "checkins"` | TRUNCATE 权限不足 → 把 `TRUNCATE TABLE checkins, settings RESTART IDENTITY;` 换成两行 `DELETE FROM checkins;` 和 `DELETE FROM settings;` |
| `violates check constraint "checkins_xxx_check"` | 数据里的中文枚举和约束对不上 → 大概率是粘贴时中文被转成了乱码，检查编辑器编码，重新复制一次 |
| `relation "checkins" does not exist` | 第 1 步没成功或不在同一个数据库/schema，回去重跑 `schema.sql` |

### 第 3 步：确认执行顺序没搞反

`seed.sql` 依赖 `schema.sql` 建好的表。顺序反了会报 `relation "checkins" does not exist`。

---

## 二、验证：5 组 SELECT

> 每组都是"跑一下、对一下"。五组全过，说明**表结构、数据、约束**三样都对。
> 建议按顺序跑，V4/V5 依赖 V1~V3 的结果。

### V1　表结构对不对

```sql
SELECT ordinal_position AS 序号, column_name AS 列名, data_type AS 类型,
       is_nullable AS 可空, column_default AS 默认值
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'checkins'
ORDER BY ordinal_position;
```

**预期：16 行**，序号 1~16 依次是 `id`(bigint) / `user_id`(bigint, 默认值 0) / `date`(date) / `exercise_type` / `exercise_minutes` / `exercise_calories` / `meal_breakfast_text` / `meal_breakfast_tag` / `meal_lunch_text` / `meal_lunch_tag` / `meal_dinner_text` / `meal_dinner_tag` / `weight_kg`(numeric) / `water_ml` / `created_at` / `updated_at`。

比对基准是 `api-contract.md` 3.2 那张表的「数据库列」一列 —— 列名必须**一字不差**。

### V2　约束在不在

```sql
SELECT rel.relname AS 表, con.conname AS 约束名,
       CASE con.contype WHEN 'p' THEN '主键' WHEN 'u' THEN '唯一' WHEN 'c' THEN 'CHECK' END AS 类型
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = rel.relnamespace
WHERE ns.nspname = 'public' AND rel.relname IN ('checkins', 'settings')
ORDER BY rel.relname, con.contype;
```

**预期：14 行** —— `checkins` 10 个（`checkins_pkey` 主键 + `checkins_user_date_key` 唯一 + 8 个 CHECK），`settings` 4 个（`settings_pkey` + `settings_user_key` + 2 个 CHECK）。

少一个就说明建表脚本没跑完整。

### V3　数据条数与断档

```sql
-- 条数与范围
SELECT count(*) AS 记录条数, min(date) AS 最早, max(date) AS 最晚 FROM checkins;

-- 哪几天没打卡
SELECT g::date AS 断档日期
FROM generate_series(DATE '2026-09-21', DATE '2026-10-01', INTERVAL '1 day') g
WHERE NOT EXISTS (SELECT 1 FROM checkins c WHERE c.date = g::date);
```

**预期**：第一条 `9 / 2026-09-21 / 2026-10-01`；第二条 **2 行**：`2026-09-26`、`2026-09-30`。

这两条断档是故意的，别当成漏插。用它们才能验证 streak 中断与坚持率分母（8/10 = 80%）。

### V4　空值真的是 NULL

```sql
SELECT
  count(*) FILTER (WHERE weight_kg IS NULL)         AS 没填体重,
  count(*) FILTER (WHERE water_ml IS NULL)          AS 没喝水,
  count(*) FILTER (WHERE exercise_type IS NULL)     AS 没运动,
  count(*) FILTER (WHERE meal_dinner_text IS NULL)  AS 没记晚餐
FROM checkins;

-- 看三条"残缺记录"长什么样
SELECT date, exercise_type, exercise_minutes, weight_kg, water_ml
FROM checkins WHERE date IN (DATE '2026-09-24', DATE '2026-09-28', DATE '2026-09-29')
ORDER BY date;
```

**预期**：第一条 `3 / 2 / 2 / 6`；第二条 3 行 —— 09-24 有运动和饮水、体重是 `<null>`；09-28 只有饮水 1500、运动与体重是 `<null>`；09-29 只有饮食、运动/体重/饮水全是 `<null>`。

重点确认**空的地方显示 `<null>` 而不是 `''` 或 `0`** —— 数据库存 NULL、云函数负责转成 `""` 给前端，这是契约 2.6 的分工。

### V5　约束拦得住坏数据（4 个压力测试）

前三个是**故意让它失败**，报错才是成功：

```sql
-- T1：体重 500 超范围（应被拦）
INSERT INTO checkins (user_id, date, weight_kg) VALUES (0, DATE '2026-10-02', 500);
-- 预期报错：violates check constraint "checkins_weight_kg_check"

-- T2：写旧标签「清爽」（应被拦）
INSERT INTO checkins (user_id, date, meal_breakfast_tag) VALUES (0, DATE '2026-10-02', '清爽');
-- 预期报错：violates check constraint "checkins_meal_breakfast_tag_check"

-- T3：同一天再插一条（应被拦 —— 这就是"一天一条"）
INSERT INTO checkins (user_id, date, water_ml) VALUES (0, DATE '2026-10-01', 999);
-- 预期报错：duplicate key value violates unique constraint "checkins_user_date_key"
```

T1~T3 报错时整条语句自动回滚，不会留下脏数据，不用清理。

第四个是**对照实验**（实际会报错，报这个错才对）：

```sql
BEGIN;
-- 故意用 NULL 当 user_id，同一天插两条
INSERT INTO checkins (user_id, date, water_ml) VALUES (NULL, DATE '2026-10-03', 100);
INSERT INTO checkins (user_id, date, water_ml) VALUES (NULL, DATE '2026-10-03', 200);
SELECT count(*) AS NULL时同一天插进了几条 FROM checkins WHERE date = DATE '2026-10-03';
ROLLBACK;
```

**预期：报错 `null value in column "user_id" ... violates not-null constraint (SQLSTATE 23502)`**

因为 `user_id` 是 `NOT NULL`，NULL 在**第一道门**就被拦下，连表都进不去，轮不到唯一约束出场。

> 说明：如果当初选的是"允许 NULL"方案，这条 INSERT 会成功、且同一天能插进两条（PG 里 NULL 互不相等，唯一约束对 NULL 形同虚设）——那是要演示的坑。现在选了 `NOT NULL DEFAULT 0`，防线前移：NULL 根本进不了表。两种结果证明的是同一个结论——**"一天一条"不会被 NULL 击穿**。
>
> 报错后事务靠连接断开时自动回滚，不会留脏数据；不放心就跑 `SELECT count(*) FROM checkins;` 核对还是 9。

---

## 三、踩坑备忘

- **重跑 `schema.sql` 会清空数据**：DROP TABLE 连数据一起删。现在库里没有真实数据，随便重跑；以后有了真实打卡记录，就只能改「只执行 CREATE 段」，或者先导出备份。
- **中文枚举别手改**：`meal_*_tag` 只接受「健康 / 普通 / 放纵」，`exercise_type` 只接受 6 种运动，写别的会被 CHECK 拦住（这是故意的，数据库是最后一道闸）。
- **`user_id` 本期恒为 0**：含义是"多人版上线前的本地唯一用户"；二期接入登录后再收编（`api-contract.md` 有说明）。
- **云函数访问权限**：本期建表用控制台身份，第 3 周云函数用 `cloudbase_postgres` 角色读这两张表。若届时接口报权限错，先查 GRANT 与 RLS 设置，不要改表结构。
