import { z } from "zod";
import type { EstimateSettings } from "@/lib/estimate-calc";

/**
 * 見積（リング2）の計算式設定スキーマ。
 *
 * 率・単価は計算エンジン `estimate-calc.ts` の `EstimateSettings` に対応する。
 * 版（識別キー＝値上げ改定の前後）は Supabase `estimate_settings` に持ち、管理画面で作成する。
 * 仕様: docs/spec/estimate/ring2-estimate.md（着手時）/ vision/case-portal.md §9（リング2）
 */

/** 計算式設定（率・単価）。 */
export const estimateSettingsSchema = z.object({
  laborUnitPrice: z.number().int().nonnegative(), // 施工人件費単価（円/時）
  travelUnitPrice: z.number().int().nonnegative(), // 移動費用単価（円/km）
  safetyRate: z.number().min(0).max(1), // 労安費率
  overheadRate: z.number().min(0).max(1), // 諸経費率
  chemicalMarkup: z.number().positive(), // 薬剤係数（売価÷係数＝原価）
  taxRate: z.number().min(0).max(1), // 消費税率
  costCoefficientOptions: z.array(z.number().positive()).max(10).default([]) // 原価係数の選択肢
});

/** 版メタ付き（識別キー＋適用開始日＋有効フラグ）＝管理画面の作成フォームが投げる形。 */
export const estimateSettingsVersionInputSchema = estimateSettingsSchema.extend({
  label: z.string().min(1).max(60), // 識別キー（例 "2026年度06月"）
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で入力してください。"),
  isActive: z.boolean().default(true),
  note: z.string().max(500).optional()
});

export type EstimateSettingsInput = z.infer<typeof estimateSettingsSchema>;
export type EstimateSettingsVersionInput = z.infer<typeof estimateSettingsVersionInputSchema>;

/** 既定（Supabase 未構成・有効な版なし時のフォールバック＝初期版と同値）。 */
export const DEFAULT_ESTIMATE_SETTINGS: EstimateSettings = {
  laborUnitPrice: 5800,
  travelUnitPrice: 270,
  safetyRate: 0.16,
  overheadRate: 0.2,
  chemicalMarkup: 1.6,
  taxRate: 0.1,
  costCoefficientOptions: [0.3, 0.55]
};
