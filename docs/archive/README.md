# アーカイブ（履歴）

過去の決定・旧仕様の保管庫。**現行の正は各 living ドキュメント**を参照。
ここは「当時こう決めた」の記録であり、一部はその後見直されている。

| ファイル | 内容 | 状態 / 後継 |
|---|---|---|
| `closed-decisions-2026-04.md` | 2026-04 にクローズした論点 | 一部は後続で**見直し**（特に「書き戻さない」→書き戻す）。各項目に注記あり |
| `integration-justdb-urlparam.md` | 旧 JUST.DB連携仕様（URLパラメータ方式・書き戻しなし） | **後継**: `architecture/justdb-supabase-integration.md` |
| `vercel-drive-v0.1.md` | 旧 Vercel+Drive運用方針 | **後継**: `architecture/overview.md` |
| `deploy-vercel.md` | 旧デプロイ手順（Vercel・非商用不可で却下） | **後継**: `runbook/deploy.md`（Cloud Run＋IAP） |
| `report-pdf-generic-v0.3.md` | 旧 報告書・PDF仕様（汎用・8枚レイアウト前提） | **後継**: `spec/report-formats.md`（実物=防除作業報告書） |
| `slack-photo-report-spec-v0.1.md` | Slack写真報告書の初期仕様（draft） | **後継**: `architecture/slack-photo-report-architecture.md`＋`spec/photo-report/slack-photo-report-impl-plan.md`（Cloud Run/IAP・Drive直読み・案件ダイジェスト統合に更新） |

注: 初期プロトタイプ `/report/new` は汎用報告書（日報/障害報告/改善提案）の雛形で、
本丸（防除作業報告書）ではない。現行の作業対象は `/mock`。
