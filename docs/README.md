# ドキュメント一覧

西武消毒の防除作業報告書アプリの仕様・設計の入口。

## 現在地（2026-06）

紺谷V／写真報告書／融合をタブ切替で出すモック（`/mock`）が稼働。Supabaseに繋ぎ、
害虫→薬剤→処理方法のカスケードと施工予定IDによるケース取得をライブ確認済み（プレゼン可）。

## 1. 仕様（spec）

- `spec/requirements.md`: 目的・スコープ・現行の決定事項
- `spec/report-formats.md`: 紺谷V／写真報告書／融合の構成、PDF・写真・注記・設定JSON
- `spec/open-issues.md`: 未確定事項
- `spec/slack-photo-report-impl-plan.md`: 写真報告書システムの**実装計画**（M1/M2達成・案件ダイジェスト統合）。**現況の正本アーキは `architecture/slack-photo-report-architecture.md`**
  - 初期仕様 `slack-photo-report.md` は `archive/` へ移動（superseded）

## 2. 設計（architecture）

- `architecture/overview.md`: 全体像（役割分担・データフロー・保管・統合戦略）
- `architecture/slack-photo-report-architecture.md`: **写真報告書システム 統合アーキ（現況の正本）**。Cloud Run/IAP・VMワーカー・案件ダイジェスト統合まで
- `architecture/slack-photo-report-simple.md`: 上記の**簡易版**（4ステップ・プレーンASCII・説明用）
- `architecture/justdb-supabase-integration.md`: JUST.DB連携・カスケード・同期・書き戻し
- `architecture/repository-structure.md`: リポジトリ構成（現況）

## 3. Runbook / デプロイ

- `runbook/deploy-vercel.md`: **ローカル開発手順**（Vercelデプロイ節は superseded＝Cloud Run採用。本番デプロイは `deployment.md`）
- `deployment.md`: **デプロイ配置メモ**（Cloud Run / IAP / OAuth / VM など資源の所在＝管理3面の地図）

## 4. 参照・資産

- `reference/防除作業報告書-原本-2006.xlsx`: 紺谷Vの原本Excel
- `supabase/schema-and-seed.sql`: Supabaseスキーマ＋シード
- `supabase/slack-photo-report-schema.sql`: 写真報告書のジョブ台帳/生成物（photo_report_jobs / photo_reports）

## 5. アーカイブ

- `archive/README.md`: 旧仕様・クローズ済み論点（一部は見直し済み）
- `archive/slack-photo-report-spec-v0.1.md`: Slack写真報告書の**初期仕様**（superseded・正本は `architecture/slack-photo-report-architecture.md`）
