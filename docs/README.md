# ドキュメント一覧

西武消毒の防除作業報告書アプリの仕様・設計の入口。

## 現在地（2026-06-20）

- **Slack写真→AI写真報告書システム**（本丸）：Slack「📸報告書」→AI下書き→WEBで仕上げ（赤丸・版管理・版名・削除）まで **Cloud Run＋IAP で prod 稼働**。**設定モーダル＋AIトーン＋PDF体裁**（齋藤マンション様 PDF 準拠）実装済。VM ワーカー（systemd 常駐）。正本＝`architecture/slack-photo-report-architecture.md`。
- **案件ダイジェスト生成 Phase D1（2026-06-20・E2E済）**：`case_digest_jobs`→VM ワーカーが未読書類＋Slack増分をマージ要約→**`_ai/digest.md` を Drive 直書き（Option A）**＋トピック要約。写真AIへ文脈(digest)を初供給。残＝Phase D2（既存 `topic-digest-gas` の API 直叩きを VM ジョブへ切替・課金停止）。
- 紺谷V／写真報告書／融合のモック（`/mock`）：Supabase 接続・カスケード・ケース取得をライブ確認済（プレゼン可）。

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

- `runbook/deploy.md`: **手順**（ローカル開発＋Cloud Run 本番＋ワーカー systemd＋migration）
- `deployment.md`: **デプロイ配置メモ**（Cloud Run / IAP / OAuth / VM など資源の所在＝管理3面の地図）

## 3.5 契約（contracts）

- `contracts/PHOTO_REPORT_API_CONTRACT.md`: 写真報告 HTTP 面（画像プロキシ＋report JSON＋版管理／設定／生成）の正本契約（D-PORTS・中央 `PORTS.md §5` に登録）

## 4. 参照・資産

- `reference/防除作業報告書-原本-2006.xlsx`: 紺谷Vの原本Excel
- `supabase/`: スキーマ／マイグレーション／シード（[`supabase/README.md`](supabase/README.md) に配置と適用順）
  - `report-app-schema.sql`（本体DDL）/ `slack-photo-report-schema.sql`（写真報告: photo_report_jobs / photo_reports）/ `migrations/`（差分）/ `seed.sql`（開発データ）

## 5. アーカイブ

- `archive/README.md`: 旧仕様・クローズ済み論点（一部は見直し済み）
- `archive/slack-photo-report-spec-v0.1.md`: Slack写真報告書の**初期仕様**（superseded・正本は `architecture/slack-photo-report-architecture.md`）
