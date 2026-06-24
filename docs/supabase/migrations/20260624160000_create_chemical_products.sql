-- 薬剤資材マスタ（販売価格表）＝JUST.DB のマスタを Supabase にミラーした単一ソース。
-- 見積（売価/原価/掛率/単位）と報告書（報告書名・中分類＝害虫カテゴリ）の双方を1表から供給する。
-- 取り込みは JUST.DB エクスポートCSV を scripts/import-price-book.mjs で upsert（価格はリポに焼かない＝ランタイム取り込み）。
-- 廃番は is_active=false の論理削除（物理削除しない運用）。
-- 仕様: docs/architecture/justdb-supabase-integration.md（Lane A マスタ）/ vision/case-portal.md §9（リング2）
create table if not exists chemical_products (
  price_table_id    text primary key,              -- 販売価格表ID（JUST.DB のキー。見積明細が参照）
  product_name      text not null,                 -- 薬剤商品名
  report_name       text,                          -- 報告書名（報告書での表示名）
  category          text,                          -- 中分類（害虫/作業カテゴリ ゴキブリ/シロアリ/モニタリング/…）
  sale_unit_price   numeric not null default 0,    -- 薬剤売価（＝計算用単価）
  cost_unit_price   numeric not null default 0,    -- 原価（＝売価 ÷ 販売掛率）
  markup            numeric,                       -- 販売掛率（1.6 / 3.2 等。品目固有）
  unit              text,                          -- 単位（L/ml/個/枚/坪/…）
  usage_per_unit    numeric,                       -- 単位あたり使用量
  search_tags       text,                          -- 検索タグ
  description       text,                          -- 薬剤説明
  note              text,                          -- 備考
  supply_list_id    text,                          -- 仕入一覧ID
  source_updated_at timestamptz,                   -- JUST.DB 側の更新日時（Lane A 差分取り込みの基準）
  is_active         boolean not null default true, -- 廃番は false（論理削除・物理削除しない）
  imported_at       timestamptz not null default now()
);

-- カテゴリ絞り込み（見積エディタの薬剤選択）。
create index if not exists idx_chemical_products_category on chemical_products (category) where is_active;

-- RLS：public/anon からは触らせない（service_role はバイパス）。
alter table chemical_products enable row level security;
