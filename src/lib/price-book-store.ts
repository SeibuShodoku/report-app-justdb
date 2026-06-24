/**
 * 販売価格表（薬剤資材マスタ・`chemical_products`）の読み出し（サーバー専用）。
 * JUST.DB ミラー。見積エディタの薬剤選択／計算と、報告書の表示名に使う。
 * DB は snake_case、アプリは camelCase。取り込みは scripts/import-price-book.mjs。
 * 仕様: docs/architecture/justdb-supabase-integration.md（Lane A）/ ring2-estimate
 */
import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";
import type { PriceBookItem } from "@/schemas/price-book";

type Row = {
  price_table_id: string;
  product_name: string;
  report_name: string | null;
  category: string | null;
  sale_unit_price: number | string;
  cost_unit_price: number | string;
  markup: number | string | null;
  unit: string | null;
  usage_per_unit: number | string | null;
  search_tags: string | null;
  description: string | null;
  note: string | null;
  supply_list_id: string | null;
  is_active: boolean;
  sort_order: number | null;
};

function rowToItem(r: Row): PriceBookItem {
  return {
    priceTableId: r.price_table_id,
    productName: r.product_name,
    reportName: r.report_name ?? undefined,
    category: r.category ?? undefined,
    saleUnitPrice: Number(r.sale_unit_price),
    costUnitPrice: Number(r.cost_unit_price),
    markup: r.markup == null ? undefined : Number(r.markup),
    unit: r.unit ?? undefined,
    usagePerUnit: r.usage_per_unit == null ? undefined : Number(r.usage_per_unit),
    searchTags: r.search_tags ?? undefined,
    description: r.description ?? undefined,
    note: r.note ?? undefined,
    supplyListId: r.supply_list_id ?? undefined,
    isActive: r.is_active
  };
}

/**
 * 販売価格表（有効品目）を取得。category 指定でカテゴリ絞り込み。
 * 並びは sort_order（JUST.DB/CSV の行順）→品目名。sort_order 未設定（未マイグレ）の行は末尾扱い。
 * ※ sort_order を ORDER 句に置くとカラム未追加時に PostgREST が失敗するため、JS 側で並べる。
 */
export async function listPriceBook(category?: string): Promise<PriceBookItem[]> {
  if (!supabaseConfigured()) return [];
  const cat = category?.trim();
  const filter = cat ? `&category=eq.${encodeURIComponent(cat)}` : "";
  const rows = await sbSelect<Row>(`chemical_products?is_active=eq.true${filter}&select=*`);
  rows.sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.product_name.localeCompare(b.product_name, "ja");
  });
  return rows.map(rowToItem);
}

/** 販売価格表の中分類（カテゴリ）一覧（薬剤選択のタブ/フィルタ用）。 */
export async function listPriceBookCategories(): Promise<string[]> {
  if (!supabaseConfigured()) return [];
  const rows = await sbSelect<{ category: string | null }>(
    `chemical_products?is_active=eq.true&select=category`
  );
  return [...new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)))].sort();
}
