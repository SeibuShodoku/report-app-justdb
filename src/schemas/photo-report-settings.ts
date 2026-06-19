import { z } from "zod";

/**
 * 写真報告書の生成設定（folder_id 単位・Supabase `photo_report_settings`）。
 * 報告書のメタ（種類・実施日・物件名・担当者）と、AI 文章のトーン（ですます/言い切り・通常/クレーム・
 * 提案重要度・法人/個人）を持つ。VM ワーカーが生成時にこれを読み、Claude プロンプトへ反映する。
 *
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6.5（設定） / ゴール＝齋藤マンション様 PDF
 */
export const reportTypeSchema = z.enum(["construction", "survey"]); // 施工 / 調査
export const tonePolitenessSchema = z.enum(["desu_masu", "plain"]); // ですます調 / 言い切り調
export const responseModeSchema = z.enum(["normal", "complaint"]); // 通常対応 / クレーム対応
export const proposalWeightSchema = z.enum(["strong", "normal", "light"]); // しっかり / 普通 / 軽め
export const clientTypeSchema = z.enum(["corporate", "individual"]); // 法人 / 個人

export const photoReportSettingsSchema = z.object({
  reportType: reportTypeSchema.default("construction"),
  execDate: z.string().max(40).optional(), // 実施日（当面は手入力。例 "2026年6月19日"）
  propertyName: z.string().max(120).optional(), // 物件名（将来 JUST.DB から取得）
  reporter: z.string().max(80).optional(), // 担当者（表紙フッター）
  tonePoliteness: tonePolitenessSchema.default("desu_masu"),
  responseMode: responseModeSchema.default("normal"),
  proposalWeight: proposalWeightSchema.default("normal"),
  clientType: clientTypeSchema.default("corporate")
});

export type PhotoReportSettings = z.infer<typeof photoReportSettingsSchema>;

/** 既定設定（未設定フォルダのフォールバック）。 */
export const DEFAULT_SETTINGS: PhotoReportSettings = photoReportSettingsSchema.parse({});

// --- UI / 表示ラベル（日本語） ---
export const REPORT_TYPE_LABEL: Record<z.infer<typeof reportTypeSchema>, string> = {
  construction: "施工",
  survey: "調査"
};
/** 表紙タイトル（施工報告書 / 調査報告書）。 */
export const REPORT_TITLE: Record<z.infer<typeof reportTypeSchema>, string> = {
  construction: "施工報告書",
  survey: "調査報告書"
};
export const TONE_POLITENESS_LABEL: Record<z.infer<typeof tonePolitenessSchema>, string> = {
  desu_masu: "ですます調",
  plain: "言い切り調"
};
export const RESPONSE_MODE_LABEL: Record<z.infer<typeof responseModeSchema>, string> = {
  normal: "通常対応",
  complaint: "クレーム対応"
};
export const PROPOSAL_WEIGHT_LABEL: Record<z.infer<typeof proposalWeightSchema>, string> = {
  strong: "しっかり提案",
  normal: "普通の提案",
  light: "軽めに提案"
};
export const CLIENT_TYPE_LABEL: Record<z.infer<typeof clientTypeSchema>, string> = {
  corporate: "法人",
  individual: "個人"
};
