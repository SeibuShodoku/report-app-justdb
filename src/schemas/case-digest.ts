import { z } from "zod";

/**
 * 案件ダイジェスト「口」への書き込み入力。
 * digest-gas（要約）→ report-app「口」が受け取り、AI専用フォルダへ永続する。
 */
export const caseDigestWriteSchema = z.object({
  caseId: z.string().min(1).max(100),
  driveFolderId: z.string().min(1).max(200), // 案件GDフォルダ（AI専用サブフォルダを作る親）
  coreMarkdown: z.string().min(1).max(200000), // コアダイジェスト本文（digest.md を上書き）
  slackSummary: z.string().max(200000).optional() // あれば Slack要約履歴に1エントリ追記
});

export type CaseDigestWrite = z.infer<typeof caseDigestWriteSchema>;
