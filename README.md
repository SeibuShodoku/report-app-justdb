# report-app-justdb

JUST.DB連携の報告書作成アプリ（Next.js + TypeScript）です。

## セットアップ

```bash
cd /home/ishibashi/dev/report-app-justdb
cp .env.example .env.local
npm install
npm run dev
```

## 環境変数

- `JUSTDB_BASE_URL`: JUST.DBのベースURL
- `JUSTDB_API_TOKEN`: APIトークン
- `JUSTDB_REPORT_ENDPOINT`: 報告書登録APIのパス（例: `/api/v1/reports`）

## APIフロー

1. ブラウザフォームから `POST /api/reports`
2. Next.js Route Handler が入力検証
3. `src/lib/justdb.ts` がJUST.DB APIへ送信

## 次の実装候補

- JUST.DBの実API仕様に合わせた項目マッピング
- 認証（社内SSO/OIDC）
- 添付ファイル対応
- 下書き保存と承認フロー
- 監査ログ
