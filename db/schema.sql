-- ============================================================================
-- Daily-Health-Log · 建表脚本（schema.sql）
-- ============================================================================
-- 用途     ：在 CloudBase PostgreSQL 里建 checkins / settings 两张表
-- 依据     ：api-contract.md 第三节「数据表」——字段与约束的唯一来源，不要另造
-- 生成日期 ：2026-10-01
-- 目标环境 ：PostgreSQL（CloudBase 环境 daily-health-log-d3eej7197499a30，PG 模式）
--
-- 【可重复执行】开头先 DROP TABLE IF EXISTS 再重建，跑多少遍结果完全一样。
--
-- 【警告：会丢数据】DROP TABLE 连表里的数据一起删。现在库里还没有这两张表、
--   也没有数据，此刻重跑是安全的；以后一旦有了真实打卡记录，重跑本脚本
--   = 清空数据。到那时请只复制 CREATE 段执行，或先导出备份。
--
-- 【执行顺序】两张表互不引用，谁先建都可以；本脚本按 checkins → settings 排。
-- 【配套文件】示例数据在 db/seed.sql（建完表后再跑它）。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 第 0 步：清场（保证可重复执行）
-- ----------------------------------------------------------------------------
-- 故意不加 CASCADE：这两张表没有被别的对象引用，不加 CASCADE 时若真有依赖
-- 会直接报错，而不是"顺手"把依赖它的东西一起删掉。报错比误删好。
DROP TABLE IF EXISTS checkins;
DROP TABLE IF EXISTS settings;


-- ----------------------------------------------------------------------------
-- 表 1：checkins —— 每日打卡记录，一天一条
-- ----------------------------------------------------------------------------
-- 列名 snake_case，API 层 camelCase，转换只在云函数做一次（契约 2.4）。
-- 业务字段一律允许留空：用户没填的项存 NULL，云函数回给前端时转成 ""（契约 2.6）。
--
-- 关于 CHECK 约束的一个 PG 常识：表达式结果为 NULL 时，CHECK 判定为"通过"。
-- 所以下面只在 CHECK 里写取值范围，不需要重复写 "OR 该列 IS NULL"。
-- 约束全部显式命名（xxx_check），以后要改（比如给运动加一种新类型）时，
-- 可以用 ALTER TABLE ... DROP CONSTRAINT 精确替换，不用猜系统自动生成的名字。
CREATE TABLE checkins (
  id                  BIGSERIAL     PRIMARY KEY,
  -- 归属用户。本期（单人自用）全部填 0，代表"多人版上线前的本地唯一用户"。
  -- 为什么不用 NULL：PG 里 NULL 互不相等，一旦 user_id 全是 NULL，
  -- UNIQUE (user_id, date) 会完全失效——同一天能存进多条记录，upsert 直接失灵。
  -- 二期接入登录后收编（TECH_DESIGN 3.7 第 7 条）：
  --   UPDATE checkins SET user_id = <你的用户 id> WHERE user_id = 0;
  --   再加外键 ALTER TABLE checkins ADD CONSTRAINT checkins_user_fk
  --     FOREIGN KEY (user_id) REFERENCES users(id);
  user_id             BIGINT        NOT NULL DEFAULT 0,
  -- 本地日期 YYYY-MM-DD。用 DATE 类型，全链路不做 UTC 换算（契约硬约束 3）
  date                DATE          NOT NULL,
  exercise_type       TEXT,
  exercise_minutes    INTEGER,
  -- 前端 calories.js 算好后随表单提交存档，后端只校验范围、不重算
  exercise_calories   INTEGER,
  meal_breakfast_text TEXT,
  meal_breakfast_tag  TEXT,
  meal_lunch_text     TEXT,
  meal_lunch_tag      TEXT,
  meal_dinner_text    TEXT,
  meal_dinner_tag     TEXT,
  -- 一位小数。注意：PG 对 NUMERIC(4,1) 超出的小数位会四舍五入而不是报错，
  -- 例如传 65.55 会存成 65.6，所以前端校验必须挡住两位小数（契约 4.7）
  weight_kg           NUMERIC(4,1),
  water_ml            INTEGER,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- 同一用户同一天只能有一条。覆盖保存走
  -- INSERT ... ON CONFLICT (user_id, date) DO UPDATE（契约 4.7）
  CONSTRAINT checkins_user_date_key UNIQUE (user_id, date),

  -- 运动类型枚举（契约 3.2）。加新运动时同步改这里 + calories.js + PRD 6.3
  CONSTRAINT checkins_exercise_type_check
    CHECK (exercise_type IN ('散步', '慢跑', '跳绳', '骑行', '力量训练', '瑜伽')),
  -- 时长 0~600 整数（PRD E5）
  CONSTRAINT checkins_exercise_minutes_check
    CHECK (exercise_minutes BETWEEN 0 AND 600),
  -- 卡路里 0~9999 整数（契约 4.7）
  CONSTRAINT checkins_exercise_calories_check
    CHECK (exercise_calories BETWEEN 0 AND 9999),
  -- 三餐标签枚举：健康 / 普通 / 放纵（PRD 6.4，对应 2 / 1 / 0 分）
  CONSTRAINT checkins_meal_breakfast_tag_check
    CHECK (meal_breakfast_tag IN ('健康', '普通', '放纵')),
  CONSTRAINT checkins_meal_lunch_tag_check
    CHECK (meal_lunch_tag IN ('健康', '普通', '放纵')),
  CONSTRAINT checkins_meal_dinner_tag_check
    CHECK (meal_dinner_tag IN ('健康', '普通', '放纵')),
  -- 体重 30~200 kg（PRD E5）
  CONSTRAINT checkins_weight_kg_check
    CHECK (weight_kg BETWEEN 30 AND 200),
  -- 饮水 0~10000 ml
  CONSTRAINT checkins_water_ml_check
    CHECK (water_ml BETWEEN 0 AND 10000)
);

COMMENT ON TABLE  checkins IS '每日打卡记录，一人一天一条（覆盖保存=upsert）';
COMMENT ON COLUMN checkins.user_id           IS '归属用户，本期固定 0（单人本地期），二期收编为真实用户 id';
COMMENT ON COLUMN checkins.date              IS '本地日期 YYYY-MM-DD，不做 UTC 换算';
COMMENT ON COLUMN checkins.exercise_calories IS '前端换算表算出的存档值，后端不重算';
COMMENT ON COLUMN checkins.updated_at        IS '由写接口在 SQL 里显式 SET，不用触发器（逻辑留在代码里好排查）';


-- ----------------------------------------------------------------------------
-- 表 2：settings —— 全局目标设置，只有一条
-- ----------------------------------------------------------------------------
-- 对应课程案例里的 plan_days（"计划/目标"角色），契约 3.3。
-- UNIQUE (user_id) + 默认值 0 保证了"单人只有一条设置"：
-- 若 user_id 用 NULL，UNIQUE 会因为 NULL 互不相等而失效，settings 能出现多行。
CREATE TABLE settings (
  id                    BIGSERIAL     PRIMARY KEY,
  user_id               BIGINT        NOT NULL DEFAULT 0,
  -- 每日运动目标（分钟），1~600 整数
  goal_exercise_minutes INTEGER       NOT NULL,
  -- 每日饮水目标（ml），1~10000 整数
  goal_water_ml         INTEGER       NOT NULL,
  -- 坚持率分母的起点（PRD F3）。接口层的铁律：这条值写进去之后永不被覆盖，
  -- 改目标不影响坚持率。这是云函数的逻辑，不在数据库里写触发器
  start_date            DATE          NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT settings_user_key UNIQUE (user_id),
  CONSTRAINT settings_goal_exercise_minutes_check
    CHECK (goal_exercise_minutes BETWEEN 1 AND 600),
  CONSTRAINT settings_goal_water_ml_check
    CHECK (goal_water_ml BETWEEN 1 AND 10000)
);

COMMENT ON TABLE  settings IS '全局目标设置，单人只有一条（二期随用户数变多）';
COMMENT ON COLUMN settings.start_date IS '坚持率起点，首次创建时写入，之后永不被覆盖（契约 3.3 规则 2）';


-- ----------------------------------------------------------------------------
-- 关于索引：故意不额外建
-- ----------------------------------------------------------------------------
-- UNIQUE (user_id, date) 已经带一个索引，够用。单人一年的数据量是 365 行，
-- 全表扫描也是毫秒级；现在加 date 单列索引只是多一个要维护的对象。
-- 等哪天数据量真的上来了（多用户 + 几年历史），再按实际慢查询补索引。


-- ----------------------------------------------------------------------------
-- 建完之后应该是这样（表清单）
-- ----------------------------------------------------------------------------
--   checkins   16 列，10 个约束（1 主键 + 1 唯一 + 8 CHECK）
--   settings    7 列，4 个约束（1 主键 + 1 唯一 + 2 CHECK）
-- ============================================================================
