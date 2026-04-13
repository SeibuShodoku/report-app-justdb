# Vercelデプロイ手順

## 1. 前提

- GitHubリポジトリ: `SeibuShodoku/report-app-justdb`
- 実行基盤: Vercel

## 2. Vercelプロジェクト作成（GUI）

1. Vercelにログイン
2. `Add New...` -> `Project`
3. GitHubの `SeibuShodoku/report-app-justdb` を選択
4. Framework Preset は `Next.js` を選択
5. `Deploy` を実行

## 3. 環境変数

Vercel Project Settings -> Environment Variables に設定する。

- `REPORT_STORAGE_DIR` = `data/reports`
- `REPORT_LINK_SECRET` = 任意の長いランダム文字列（将来トークン有効化時）

注記: 現在はトークンなし運用のため `REPORT_LINK_SECRET` は必須ではないが、先行設定を推奨。

## 4. 動作確認URL

デプロイ後のURLに対して以下形式でアクセスする。

```text
https://<vercel-domain>/report/new?caseId=CASE001&investigationId=INV001&constructionId=CONST001&driveFolderUrl=https%3A%2F%2Fdrive.google.com%2Fdrive%2Ffolders%2Fxxxxx
```

## 5. JUST.DBに登録するアプリURL

以下をそのままテンプレートとして登録する。

```text
https://<vercel-domain>/report/new?caseId={案件ID}&investigationId={調査予定ID}&constructionId={施工予定ID}&driveFolderUrl={URLエンコード済みGoogleDriveフォルダURL}
```

## 6. CLI利用（任意）

ローカルから実施する場合。

```bash
npm i -g vercel
vercel login
cd /home/ishibashi/dev/projects/report-app-justdb
vercel
vercel --prod
```
