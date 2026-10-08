-- 软删除：给 checkins 加 is_deleted 标记，并把唯一约束改成只对未删行生效
--
-- 为什么不是简单加一列：原来的 UNIQUE(user_id, date) 是全表生效的。
-- 软删后旧行仍在表里占着那个日期，重新打卡同一天会撞 23505 插不进去，那天就被永久锁死。
-- 换成分部唯一索引（WHERE NOT is_deleted）后：
--   同一天最多一条「未删」记录（原防重语义不变），同时可留任意多条已删历史行。

ALTER TABLE public.checkins
  ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.checkins
  DROP CONSTRAINT checkins_user_date_key;

CREATE UNIQUE INDEX checkins_user_date_active_key
  ON public.checkins (user_id, date)
  WHERE NOT is_deleted;
