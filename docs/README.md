# ドキュメント一覧

西武消毒の防除作業報告書アプリの仕様・設計の入口。

## 現在地（2026-06）

紺谷V／写真報告書／融合をタブ切替で出すモック（`/mock`）が稼働。Supabaseに繋ぎ、
害虫→薬剤→処理方法のカスケードと施工予定IDによるケース取得をライブ確認済み（プレゼン可）。

## 1. 仕様（spec）

- `spec/requirements.md`: 目的・スコープ・現行の決定事項
- `spec/report-formats.md`: 紺谷V／写真報告書／融合の構成、PDF・写真・注記・設定JSON
- `spec/open-issues.md`: 未確定事項
- `spec/slack-photo-report.md`: **Slack 写真 → AI 写真報告書**の自動生成（VM 常駐 Claude＋画像プロキシ BFF）。draft
- `spec/slack-photo-report-impl-plan.md`: 上記の実装計画（WEB/BFF→VM AI→GAS の3トラック）。draft

## 2. 設計（architecture）

- `architecture/overview.md`: 全体像（役割分担・データフロー・保管・統合戦略）
- `architecture/slack-photo-report-architecture.md`: **写真報告書システム 統合アーキ（現況の正本）**。Cloud Run/IAP・VMワーカー・案件ダイジェスト統合まで
- `architecture/justdb-supabase-integration.md`: JUST.DB連携・カスケード・同期・書き戻し
- `architecture/repository-structure.md`: リポジトリ構成（現況）

## 3. Runbook / デプロイ

- `runbook/deploy-vercel.md`: ローカル開発／デプロイ手順
- `deployment.md`: **デプロイ配置メモ**（Cloud Run / OAuth / SA / VM など資源の所在＝管理3面の地図）

## 4. 参照・資産

- `reference/防除作業報告書-原本-2006.xlsx`: 紺谷Vの原本Excel
- `supabase/schema-and-seed.sql`: Supabaseスキーマ＋シード

## 5. アーカイブ

- `archive/README.md`: 旧仕様・クローズ済み論点（一部は見直し済み）
