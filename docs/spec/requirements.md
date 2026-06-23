# 要件定義（v1.0）

> **位置づけ：本書は「防除WEBアプリ部分」の要件（v1.0）。** 本番稼働の写真報告書は
> [`architecture/slack-photo-report-architecture.md`](../architecture/slack-photo-report-architecture.md)、向かう先（北極星）は
> [`vision/case-portal.md`](../vision/case-portal.md)。

## 1. 背景

西武消毒（城東支店・東京支店）の報告書業務が様式乱立で、端末差による印刷崩れや、
顧客監査で月替りに異なる様式が届くクレームが発生。共通の仕組みに寄せるDX。
本丸は**施工報告書（防除作業報告書）**——最も現場に刺さるため。
戦略「統合の手前」と全体像は `docs/architecture/overview.md`。

## 2. 目的

- 報告書をブラウザで作成し、固定レイアウトのPDFを1件単位で出力できる
- JUST.DBから施工単位で起動し、ケースデータと薬剤マスタを引いて入力を軽くする
- 同一データから複数様式（紺谷V／写真報告書／融合）をタブ切替で出力できる
- 画像と設定を再利用して再編集・再出力できる

## 3. スコープ

### 3.1 対象
- 報告書作成画面（紺谷V／写真報告書／融合）
- 害虫→薬剤→処理方法のカスケード入力（Supabaseミラー）
- 施工予定IDによるケースデータ取得
- 画像注記（赤丸等）／ローカル写真取込（単体・フォルダ）
- PDF出力／Google Drive保存／設定ファイル保存・読込（再編集）
- 確定マニフェストによる案件×時系列の陳列（社内面/顧客面 同形・`vision/case-portal.md §4.5`）
- JUST.DB は **read-only**（ケース文脈を読むだけ・書き戻さない）

### 3.2 非対象（現時点）
- CSV出力／Excel最終帳票の正式運用／複数案件一括PDF
- 報告書テキスト全文のJUST.DB保持（要約のみ）
- **JUST.DBへの書き戻し（金額・回数・薬剤・要約）＝将来の Schedule／終了報告へ移設**（2026-06-21 切り分け。本サイトは read-only）

## 4. 決定事項（現行）

- 出力はPDF（A4固定）、1件単位、サーバー生成を志向
- 本丸の様式は防除作業報告書（紺谷V）。写真報告書と融合可能にする
- JUST.DB＝正本／Supabase＝ミラー・取得層／WEB＝作成・出力／Drive＝保管
- アンカーは施工予定ID（→案件ID→受注ID/見積書）
- 薬剤資材はSupabaseにミラーし、害虫→薬剤→処理方法をカスケードで絞り込む
- **報告書サイトは JUST.DB を read-only（書き戻さない）**。限定フィールド書き戻し（旧「書き戻さない→限定書き戻し」の論点）は将来の Schedule／終了報告へ移設（2026-06-21 切り分け）
- 保存方式の既定は方式B（帳票割当写真のみ）。`driveFolderUrl` を正規入力
- 当面トークンなし運用（Slack写真報告フローは起動トークン必須）
- **実行基盤＝Cloud Run＋IAP（2026-06-19 確定）**。Vercel Hobby は非商用不可で却下。手順＝`runbook/deploy.md`・資源＝`deployment.md`

## 5. 成果物定義

- 報告書PDF（1件単位）／再編集用JSON／注記付き画像（Drive、管理番号で連結）
- 確定マニフェスト（`case_deliverables`）＝案件×時系列の陳列データ（社内/顧客 同形）

## 6. 非機能要件（初期）

- 入力必須項目のバリデーション
- 監査ログ（作成者・作成日時・案件ID）。防除用医薬品の使用記録は保管義務に留意
  - **写真報告フローでは設計で充足（2026-06-19）**：作成者＝版JSON `createdBy`（IAPメール）/ 日時＝`generated_at`・ジョブ時刻 / 案件＝`case_id`・`folder_id` / 内容＝版JSON append-only（不変）。詳細＝`architecture/slack-photo-report-architecture.md §8.1`。
- コスト最適化（画像圧縮、PDF生成は明示操作時のみ）

## 7. 関連ドキュメント

- 様式: `spec/report-formats.md` ／ 未確定: `spec/open-issues.md`
- 全体像: `architecture/overview.md` ／ 連携: `architecture/justdb-supabase-integration.md`
- 構成: `architecture/repository-structure.md` ／ デプロイ: `runbook/deploy.md`
