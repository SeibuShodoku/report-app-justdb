# report-app-justdb

西武消毒の**案件報告書を WEB で作成・共有するアプリ**。写真報告書（現場写真→AI下書き→赤丸・版管理）が
**Cloud Run＋IAP で本番稼働**。防除作業報告書（紺谷V）と融合し、最終的に**案件単位の顧客ポータル**へ育てる
（北極星＝[`docs/vision/case-portal.md`](docs/vision/case-portal.md)・root `decisions.md` D-PORTAL）。
JUST.DBを正本、Supabaseをジョブ台帳・取得層、Google Driveを保管（写真・版履歴・digest）に使う。

## 現在地（2026-06-20）

- **写真報告書（独立・本番）**：Slack「📸報告書」→AI下書き→WEBで仕上げ（赤丸・版管理・版名・削除）。設定モーダル＋AIトーン＋PDF体裁・VMワーカー・案件ダイジェスト（D2 統一正本モデル）まで稼働。正本＝`docs/architecture/slack-photo-report-architecture.md`。
- **防除作業報告書（紺谷V）／融合**：同一データを**タブ切替で出すモック（`/mock`）**が稼働（薬剤カスケード・ケース取得をライブ確認済）。実体化は**凍結中**（リング1で着手予定）。
- **PDF はシステムの責務ではない**（人がブラウザから任意で印刷）。

## 方針（要点）

- 北極星＝**案件ポータル**（報告書統合→社内/顧客2画面→双方向）。詳細＝[`docs/vision/case-portal.md`](docs/vision/case-portal.md)。
- アンカーは案件（→施工予定ID→受注ID/見積書）。JUST.DB＝正本／Supabase＝ジョブ台帳・取得層／WEB＝作成・編集・版管理／Drive＝保管。
- 防除mode：薬剤資材はSupabaseにミラーし害虫→薬剤→処理方法をカスケード／JUST.DBへ限定フィールド（金額・回数・薬剤・要約）を書き戻す（**凍結中**）。

詳細は `docs/README.md`（現況アーキ＝`docs/architecture/`、北極星＝`docs/vision/case-portal.md`）。

## セットアップ

```bash
cp .env.example .env.local   # SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY などを記入
npm install
npm run dev                  # http://localhost:3000/mock
```

Supabaseの初期化は `docs/architecture/justdb-supabase-integration.md` を参照。

## 環境変数

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: 薬剤資材ミラー・ケースデータ取得（サーバー専用）
- `REPORT_LINK_SECRET`: 将来のトークン検証用
- `REPORT_STORAGE_DIR`: 旧・ローカル保存先（本番非永続。Drive保管へ置換予定）
