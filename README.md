# report-app-justdb

西武消毒の**防除作業報告書**をWEBで作成し、PDF出力するアプリ。
JUST.DBを正本、Supabaseをミラー・取得層、WEBを作成・出力、Google Driveを保管に使う。

## 現在地

同一データから**タブ切替で紺谷V／写真報告書／融合**を出すモック（`/mock`）が稼働。
Supabaseに接続し、害虫→薬剤→処理方法のカスケードと、施工予定IDによるケース取得をライブ確認済み。

## 方針（要点）

- 本丸は施工報告書（防除作業報告書＝紺谷V）。写真報告書と融合可能にする
- アンカーは施工予定ID（→案件ID→受注ID/見積書）
- 薬剤資材はSupabaseにミラーし、カスケードで絞り込む
- JUST.DBへは限定フィールド（金額・回数・薬剤・要約）を書き戻す
- 保存はDrive（PDF＋再編集JSON＋写真、方式B、管理番号で連結）

詳細は `docs/README.md`（全体像は `docs/architecture/overview.md`）。

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
