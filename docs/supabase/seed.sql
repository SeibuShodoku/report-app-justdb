-- =============================================================
-- 防除作業報告書アプリ / Supabase シード（開発・デモ用）
-- 役割: report-app-schema.sql 適用後に入れる開発/デモデータ。
--       chemicals は本番では JUST.DB 同期が正本（このシードは API 未接続時のプレゼン代替）。
-- 適用: Supabase SQL Editor で report-app-schema.sql の後に実行。冪等（on conflict）。
-- =============================================================

insert into pests (name) values ('ネズミ'), ('ゴキブリ')
  on conflict (name) do nothing;

insert into chemicals (justdb_id, name, unit, applicable_pests, methods) values
  ('CHM-001', 'クマリン系粉剤',   'g', '{ネズミ}',        '{交換,配置}'),
  ('CHM-002', 'ヒドラメチルノン', 'g', '{ゴキブリ}',      '{配置}'),
  ('CHM-003', 'フィプロニル',     'g', '{ゴキブリ}',      '{配置,塗布}'),
  ('CHM-004', 'リン化亜鉛',       'g', '{ネズミ}',        '{配置}')
  on conflict (justdb_id) do update
    set name = excluded.name,
        unit = excluded.unit,
        applicable_pests = excluded.applicable_pests,
        methods = excluded.methods,
        synced_at = now();

insert into construction_schedules
  (construction_id, case_id, order_id, customer_name, site, scheduled_at, report_date) values
  ('CONST001', 'CASE001', 'ORD001', '心行寺', '江東区南砂', '2026-03-01T09:00:00+09:00', '2026-03-01'),
  ('CONST002', 'CASE002', 'ORD002', '南砂町ビル管理組合', '江東区南砂2-1', '2026-03-05T13:30:00+09:00', '2026-03-05')
  on conflict (construction_id) do nothing;
