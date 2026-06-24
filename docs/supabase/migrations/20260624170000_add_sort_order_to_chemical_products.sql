-- 販売価格表（薬剤資材マスタ）の表示順をコントロールする sort_order。
-- JUST.DB エクスポートCSV の行順を scripts/import-price-book.mjs が格納＝JUST.DB 側で並べた順を保持する。
-- 既存行は null（再取り込みで埋まる）。null は末尾扱い＋品目名でフォールバック（store 側で JS ソート）。
alter table chemical_products add column if not exists sort_order integer;
create index if not exists idx_chemical_products_sort on chemical_products (sort_order);
