/**
 * 案件ダイジェスト「口」の定数とユーティリティ。
 * AI専用フォルダ内に: コアダイジェスト(digest.md) と Slack要約履歴(slack-summary-history.md) を持つ。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §4
 */
export const DIGEST_FILE = "digest.md";
export const SLACK_HISTORY_FILE = "slack-summary-history.md";

/**
 * Slack要約“履歴”ファイルに1エントリ追記する（純粋関数・テスト対象）。
 * トピックは上書きで履歴が消えるため、md側に時系列で残す（古い→新しいで末尾に追記）。
 */
export function appendSlackHistory(
  existing: string | null,
  entry: string,
  isoTime: string
): string {
  const head = "# Slack要約 履歴（AI自動・編集禁止）\n";
  const block = `\n---\n## ${isoTime}\n\n${entry.trim()}\n`;
  if (!existing || !existing.trim()) return head + block;
  return existing.replace(/\s+$/, "") + "\n" + block;
}
