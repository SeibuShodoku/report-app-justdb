# report-app-justdb

JUST.DB起点で1件単位の報告書を作成し、最終的にPDFを生成するWebアプリです。

## 現在の方針

- JUST.DB連携はURLパラメータ方式を採用
- JUST.DBへの書き戻しは行わない（起動元のみ）
- 受信した案件ID/調査予定ID/施工予定IDを外部キーとしてアプリ側で保存する
- 保存先はGoogle Drive（既存案件フォルダ）
- JUST.DBからは `driveFolderUrl` を渡す
- 既定の保存方式は方式B（帳票に割り当てた写真のみ）
- 実行基盤はVercel
- 正式帳票はPDF出力を採用

## ドキュメント

- 仕様入口: `docs/README.md`
- 要件定義: `docs/spec/requirements.md`
- JUST.DB連携: `docs/spec/integration-justdb.md`
- PDF仕様: `docs/spec/report-pdf.md`
- 未確定事項: `docs/spec/open-issues.md`
- Vercel/Drive方針: `docs/architecture/vercel-drive.md`

## セットアップ

```bash
cd /home/ishibashi/dev/projects/report-app-justdb
cp .env.example .env.local
npm install
npm run dev
```

## 起動方法（URLパラメータ方式）

例:

```text
/report/new?caseId=CASE001&investigationId=INV001&constructionId=CONST001&driveFolderUrl=https%3A%2F%2Fdrive.google.com%2Fdrive%2Ffolders%2Fxxxxx
```

## 環境変数

- `REPORT_LINK_SECRET`: 将来のトークン検証で使用する秘密鍵
- `REPORT_STORAGE_DIR`: 報告書JSON保存先（未指定時 `data/reports`）
