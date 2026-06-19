/**
 * 報告書の版（バージョン）に関する純粋ヘルパ。
 *
 * 版履歴は Drive `_ai/reports/<folder_id>/v0001.json, v0002.json …`（append-only・不変）。
 * 現在版は Supabase `photo_reports`（folder_id キー・1件・上書き）。Slack リンク先は常に現在版。
 * - 「書いたら不変」＝最新は最大番号。ロールバックも「旧版の内容で新版を書く」＝1版として記録（監査）。
 * - 各版ファイルは自己記述（version/generatedAt/source/note/folderName/report）。可変インデックスは持たない。
 *
 * ここは Drive I/O を持たない純粋ロジックのみ（drive-write.ts から呼ばれる）。テスト対象。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §5
 */
import type { PhotoReportDraft } from "@/schemas/photo-report";

/** 版ファイル名の形（4桁ゼロ詰め）。例: v0001.json */
const VERSION_FILE_RE = /^v(\d{1,9})\.json$/i;

export type ReportVersionSource = "ai" | "human";

/** Drive に書く自己記述な版ファイルの中身。 */
export type ReportVersionFile = {
  version: number;
  generatedAt: string; // ISO8601
  source: ReportVersionSource;
  note?: string;
  folderName?: string;
  report: PhotoReportDraft;
};

/** 版ファイル名から版番号を取り出す。版ファイルでなければ null。 */
export function parseVersionNumber(name: string): number | null {
  const m = VERSION_FILE_RE.exec(name.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 版番号 → ファイル名（4桁ゼロ詰め。1万版以降は桁が伸びるが順序は数値で扱う）。 */
export function formatVersionFileName(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`版番号が不正です: ${n}`);
  }
  return `v${String(n).padStart(4, "0")}.json`;
}

/** 既存ファイル名群から次の版番号を決める（最大版＋1。無ければ1）。 */
export function nextVersionNumber(existingNames: string[]): number {
  let max = 0;
  for (const name of existingNames) {
    const n = parseVersionNumber(name);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/** 自己記述な版ファイルの中身を組み立てる（JSON文字列化は呼び出し側）。 */
export function buildVersionFile(args: {
  version: number;
  report: PhotoReportDraft;
  source: ReportVersionSource;
  note?: string;
  folderName?: string;
  now?: Date;
}): ReportVersionFile {
  return {
    version: args.version,
    generatedAt: (args.now ?? new Date()).toISOString(),
    source: args.source,
    ...(args.note ? { note: args.note } : {}),
    ...(args.folderName ? { folderName: args.folderName } : {}),
    report: args.report
  };
}
