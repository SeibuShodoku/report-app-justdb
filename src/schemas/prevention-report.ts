import { z } from "zod";

/**
 * 防除作業報告書（紺谷V）の下書き（report JSON）。
 *
 * 写真報告書（`photo-report.ts`）と**同じ版管理基盤**（`report-versions.ts`／Drive `_ai/reports/<folder_id>/v*.json`
 * append-only ＋ Supabase 現在版）で版を持つ。型は別物。
 * - キー＝`folder_id`（写真と同一機構）。`caseId`/`constructionId` は `/api/case` プリフィルの文脈。
 * - **使用薬剤必須**：施工内容の少なくとも1行に `chemical`（`superRefine`）。
 *
 * 仕様: docs/spec/ring1a-prevention-report.md / docs/vision/case-portal.md §4.5
 */

/** 施工内容の1行（害虫→薬剤→処理方法のカスケード＋使用量・備考）。 */
export const preventionWorkRowSchema = z.object({
  id: z.string().min(1).max(64),
  pest: z.string().max(50).default(""), // 対象害虫
  chemical: z.string().max(120).default(""), // 使用薬剤（必須＝下の refine）
  method: z.string().max(120).default(""), // 処理方法
  amount: z.string().max(50).default(""), // 薬剤使用量
  note: z.string().max(500).optional() // 備考
});

/** 生息状況テーブルの1行。 */
export const preventionStatusRowSchema = z.object({
  pest: z.string().max(50).default(""),
  status: z.string().max(50).default("") // 生息状況
});

export const preventionReportDraftSchema = z
  .object({
    caseId: z.string().min(1).max(100),
    constructionId: z.string().max(100).optional(),
    driveFolderId: z.string().min(1).max(200),
    // ヘッダ
    reportDate: z.string().max(40).optional(), // 報告日（当面手入力・表示用文字列 例 "2026年6月20日"）
    customer: z.string().max(200).optional(), // 顧客名
    site: z.string().max(200).optional(), // 施工場所/物件名
    manager: z.string().max(100).optional(), // 管理責任者
    supervisor: z.string().max(100).optional(), // 作業責任者
    worker: z.string().max(100).optional(), // 作業員
    workDate: z.string().max(40).optional(), // 施工日（当面手入力・表示用文字列）
    // 施工内容（縦持ち）
    workItems: z.array(preventionWorkRowSchema).max(100).default([]),
    // 駆除作業報告（施工内容＋定型から生成・編集可。将来AI）
    reportText: z.string().max(4000).optional(),
    // 生息状況
    statusItems: z.array(preventionStatusRowSchema).max(100).default([]),
    // 効果判定（紺谷Vの判定欄。当面は自由文字列）
    effectRating: z.string().max(40).optional(),
    reporter: z.string().max(80).optional(),
    generatedAt: z.string().datetime().optional()
  })
  .superRefine((data, ctx) => {
    // 使用薬剤必須：少なくとも1行に非空 chemical（無ければ保存不可）。
    const hasChemical = data.workItems.some((r) => r.chemical && r.chemical.trim().length > 0);
    if (!hasChemical) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workItems"],
        message: "使用薬剤を最低1つ入力してください（施工内容の薬剤欄）。"
      });
    }
  });

export type PreventionWorkRow = z.infer<typeof preventionWorkRowSchema>;
export type PreventionStatusRow = z.infer<typeof preventionStatusRowSchema>;
export type PreventionReportDraft = z.infer<typeof preventionReportDraftSchema>;
