import { z } from "zod";

/**
 * AI（VM 常駐 Claude）が生成する写真報告書の下書き（report JSON）。
 *
 * 既存 `reportSubmissionSchema`（手動フォーム入力・写真 max8・imageUrl は絶対URL）とは別物。
 * - 写真は Drive の `fileId` で参照する（描画側で `/api/photo?fileId=…` に解決）。
 *   絶対URL縛りを避けつつ、参照を安定させるため。
 * - 写真枚数の上限を大きく取る（Drive 直投入で 10 枚の壁が無いため）。
 *
 * 仕様: report-app-justdb/docs/spec/slack-photo-report.md §6
 */
export const photoDraftItemSchema = z.object({
  fileId: z.string().min(1).max(200),
  heading: z.string().max(80).optional(),
  annotationNote: z.string().max(500).optional()
});

export const photoReportDraftSchema = z.object({
  caseId: z.string().min(1).max(100),
  constructionId: z.string().max(100).optional(),
  investigationId: z.string().max(100).optional(),
  driveFolderId: z.string().min(1).max(200),
  headerSummary: z.string().max(2000).optional(),
  reporter: z.string().max(80).optional(),
  generatedAt: z.string().datetime().optional(),
  photoItems: z.array(photoDraftItemSchema).min(1).max(200)
});

export type PhotoDraftItem = z.infer<typeof photoDraftItemSchema>;
export type PhotoReportDraft = z.infer<typeof photoReportDraftSchema>;
