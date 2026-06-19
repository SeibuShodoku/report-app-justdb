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

/**
 * 赤丸など注記（annotation）。写真ピクセルは編集せず、JSON のオーバーレイとして持つ。
 * - 座標は **0〜1 の正規化値**（表示サイズ・プロキシのリサイズに非依存で写真にピタリ重なる）。
 * - 図形ごとに 1 要素＝選択/削除が容易・印刷でも崩れない（ベクター）。
 * - 基本図形は幾何データのみ（画像不要）。再利用スタンプのみ `asset` で名前参照。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6 / report-formats.md §3
 */
export const annotationPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1)
});

export const annotationSchema = z.object({
  id: z.string().min(1).max(64),
  // circle/rect=対角2点, line/arrow=始点終点, freehand=折れ線, text/stamp=基準1点
  type: z.enum(["circle", "rect", "arrow", "line", "freehand", "text", "stamp"]),
  points: z.array(annotationPointSchema).max(4096).default([]),
  color: z.string().max(32).optional(),
  strokeWidth: z.number().min(0).max(64).optional(),
  text: z.string().max(500).optional(), // type=text の本文
  asset: z.string().max(120).optional() // type=stamp の再利用素材名
});

export const photoDraftItemSchema = z.object({
  fileId: z.string().min(1).max(200),
  heading: z.string().max(80).optional(),
  annotationNote: z.string().max(500).optional(),
  // 赤丸など重ね描き。UI は後フェーズだが、版に乗るよう先行予約（既定は空）。
  annotations: z.array(annotationSchema).max(200).default([])
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

export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotationPoint = z.infer<typeof annotationPointSchema>;
export type PhotoDraftItem = z.infer<typeof photoDraftItemSchema>;
export type PhotoReportDraft = z.infer<typeof photoReportDraftSchema>;
