-- =============================================================
-- 防除作業報告書アプリ / Supabase スキーマ + シード
-- 役割: JUST.DB の薬剤資材テーブル（正本）のミラー + ケースデータ
-- 適用: Supabase ダッシュボード → SQL Editor に貼り付けて実行
-- 備考: 読み取りはすべて Next の API ルートからサービスロールキーで行うため
--       RLS ポリシーは不要（サービスロールは RLS をバイパス）。
-- =============================================================

-- 害虫マスタ（カスケード1段目）
create table if not exists pests (
  id   bigint generated always as identity primary key,
  name text not null unique
);

-- 薬剤資材ミラー（正本=JUST.DB。justdb_id を同期キーにする）
-- applicable_pests: 適用害虫（カスケード 害虫→薬剤 に使用）
-- methods:          処理方法（カスケード 薬剤→処理方法 に使用）
create table if not exists chemicals (
  id               bigint generated always as identity primary key,
  justdb_id        text unique,
  name             text not null,
  unit             text not null default 'g',
  applicable_pests text[] not null default '{}',
  methods          text[] not null default '{}',
  synced_at        timestamptz not null default now()
);

-- 施工日程（JUST.DB由来。施工予定ID=アンカー。報告書と1:1）
create table if not exists construction_schedules (
  construction_id text primary key,   -- 施工予定ID
  case_id         text,               -- 案件ID（FK相当: ここから受注ID/見積書を辿る）
  order_id        text,               -- 受注ID
  customer_name   text,               -- 顧客名（宛先）
  site            text,               -- 施工先
  scheduled_at    timestamptz,        -- 施工日時
  report_date     date                -- 報告日
);

-- ------------------------- シード -------------------------
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
