import { z } from "zod";

/**
 * 販売価格表（薬剤資材マスタ）の1品目。JUST.DB マスタの Supabase ミラー（`chemical_products`）。
 * 見積の価格（売価/原価/掛率/単位）と報告書の表示名/カテゴリを1ソースから供給する。
 * 仕様: docs/architecture/justdb-supabase-integration.md（Lane A）/ ring2-estimate
 */
export const priceBookItemSchema = z.object({
  priceTableId: z.string().min(1), // 販売価格表ID（見積明細が参照するキー）
  productName: z.string().min(1), // 薬剤商品名
  reportName: z.string().optional(), // 報告書名（報告書での表示）
  category: z.string().optional(), // 中分類（害虫/作業カテゴリ）
  saleUnitPrice: z.number().nonnegative(), // 薬剤売価（＝計算用単価）
  costUnitPrice: z.number().nonnegative(), // 原価
  markup: z.number().positive().optional(), // 販売掛率（売価÷掛率＝原価）
  unit: z.string().optional(), // 単位
  usagePerUnit: z.number().optional(), // 単位あたり使用量
  searchTags: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
  supplyListId: z.string().optional(),
  isActive: z.boolean().default(true)
});

export type PriceBookItem = z.infer<typeof priceBookItemSchema>;
