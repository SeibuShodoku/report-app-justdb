-- 見積（リング2）の計算式設定＝版付き。値上げ改定の前後で版を切り替える「識別キー的な管理」をサイト内に持つ。
-- 計算エンジン（src/lib/estimate-calc.ts）は定数（人件費単価・移動単価・各率・薬剤係数・消費税率）を
-- ハードコードせず、本表の版を引数で受け取る。見積日に有効な版（is_active かつ effective_from <= 見積日 の最新）を採用。
-- 削除は is_active=false の論理削除（物理削除しない運用）。仕様: docs/spec/estimate/ring2-estimate.md/ vision/case-portal.md §9
create table if not exists estimate_settings (
  id                        bigint generated always as identity primary key,
  label                     text not null unique,            -- 識別キー（人間可読 例 "2026年度06月"）
  effective_from            date not null,                   -- 適用開始日（この日以降に作る見積へ適用）
  labor_unit_price          integer not null,                -- 施工人件費単価（円/時）
  travel_unit_price         integer not null,                -- 移動費用単価（円/km）
  safety_rate               numeric not null,                -- 労安費率
  overhead_rate             numeric not null,                -- 諸経費率
  chemical_markup           numeric not null,                -- 薬剤係数（売価 ÷ 係数 ＝ 原価）
  tax_rate                  numeric not null,                -- 消費税率
  cost_coefficient_options  numeric[] not null default '{}', -- 原価係数の選択肢（UIプルダウン）
  is_active                 boolean not null default true,   -- 論理削除（無効化）用。物理削除はしない運用
  note                      text,
  created_by                text,                            -- IAP メール
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- 見積日に有効な版を引く（effective_from の新しい順）。
create index if not exists idx_estimate_settings_effective on estimate_settings (effective_from desc);

-- RLS：public/anon からは触らせない（service_role はバイパス）。
alter table estimate_settings enable row level security;

-- 初期版（2026年度06月。JUST.DB 見積CSV 20260624 から起こし、実レコードで検算済の係数）。再実行は冪等。
insert into estimate_settings
  (label, effective_from, labor_unit_price, travel_unit_price, safety_rate, overhead_rate, chemical_markup, tax_rate, cost_coefficient_options, note)
values
  ('2026年度06月', '2026-04-01', 5800, 270, 0.16, 0.20, 1.6, 0.10, '{0.3,0.55}', 'JUST.DB 見積CSV(20260624) から起こした初期版')
on conflict (label) do nothing;
