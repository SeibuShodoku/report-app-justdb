# 実行手順（ローカル開発 / Vercelデプロイ）

状態（2026-06）: **未デプロイ**。現在はローカル＋Supabaseでモックを稼働。

## 1. ローカル開発（モック）

```bash
cp .env.example .env.local   # 値を記入（.env.local は Git 管理外）
npm install
npm run dev                  # http://localhost:3000/mock
```

`.env.local` に必要な値:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用・クライアントに出さない）
- `REPORT_LINK_SECRET`（将来のトークン検証用）

Supabaseの初期化（プロジェクト作成→`docs/supabase/schema-and-seed.sql` 実行→疎通確認）は
`docs/architecture/justdb-supabase-integration.md` の「セットアップ」を参照。

## 2. Vercelデプロイ

1. Vercel にログイン → `Add New...` → `Project`
2. GitHub の `SeibuShodoku/report-app-justdb` を選択（Framework: Next.js）
3. Project Settings → Environment Variables に設定:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
   - `REPORT_LINK_SECRET`（将来トークン有効化時）
4. `Deploy`

注意:
- ローカルFS保存（旧 `data/reports`）はVercelで永続しない。永続はDrive（＋Supabase）が担う。
- 実行基盤は確定ではない（`spec/open-issues.md`）。

## 3. JUST.DB起動リンク（将来）

```text
https://<vercel-domain>/report/new?caseId={案件ID}&investigationId={調査予定ID}&constructionId={施工予定ID}&driveFolderUrl={URLエンコード済みGoogleDriveフォルダURL}
```

パラメータ定義は `architecture/justdb-supabase-integration.md`。

## 4. CLI（任意）

```bash
npm i -g vercel && vercel login && vercel && vercel --prod
```
