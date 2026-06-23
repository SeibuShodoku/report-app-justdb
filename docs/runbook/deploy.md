# デプロイ手順（ローカル開発 / Cloud Run 本番）

最終更新：2026-06-19
本番＝**Cloud Run＋IAP**（@seibu-s.co.jp 限定 SSO）。資源の所在台帳は [`../deployment.md`](../deployment.md)。
（旧 Vercel 手順は `../archive/deploy-vercel.md`＝非商用不可で却下・superseded）

## 1. ローカル開発（モック）

```bash
cp .env.example .env.local   # 値を記入（.env.local は Git 管理外）
npm install
npm run dev                  # http://localhost:3000/mock
```

`.env.local` の主な値（サーバー専用・`NEXT_PUBLIC_` は付けない）:
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_LINK_SECRET`（起動トークン署名・検証。`/report/photo` は token 必須）
- 画像プロキシ／版書込み: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_DRIVE_REFRESH_TOKEN`（社内ユーザー OAuth）
- `DRIVE_PROXY_SERVER_SECRET`（VM ワーカーと同値）

> ローカルFS保存（旧 `data/reports`）は本番非永続。永続は Drive（＋Supabase）。

## 2. 本番デプロイ（Cloud Run）

前提：`gcloud auth login`（mgmt-strat@seibu-s.co.jp）。OAuth クライアントの GCP プロジェクトで Drive API 有効化済み。

```bash
gcloud run deploy report-app-justdb \
  --source . \
  --region asia-northeast1 \
  --project seibu-dispatch-poc-tky \
  --memory 2Gi --cpu 2 \
  --quiet
```

- `--source .` で Dockerfile を Cloud Build → 新リビジョン配信。**env / IAP / サービスアカウントは既存リビジョンから継承**（秘密の再投入不要）。
- **`--memory 2Gi --cpu 2` は必須**（サーバーPDFの Chromium がメモリ食い。512Mi 既定だと PDF 生成でクラッシュしうる）。Dockerfile が `chromium`/`fonts-noto-cjk`/`dumb-init` を入れるためイメージは +約300MB。
- 確認：`✓ ... revision report-app-justdb-XXXXX has been deployed and is serving 100 percent`。URL は不変（IAP 経由のみ到達）。
- **初回のみ** env を投入（以後は継承）：`--env-vars-file env.yaml` に
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_DRIVE_REFRESH_TOKEN`(RW) / `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `REPORT_LINK_SECRET` / `DRIVE_PROXY_SERVER_SECRET`（`env.yaml` は Git 管理外）。
- IAP・SA・アクセスモデルは `../deployment.md`。

## 3. Supabase マイグレーション

新しい差分は `../supabase/migrations/` に追加し、**Supabase ダッシュボード → SQL Editor** に**古い順**で貼り付けて実行（各ファイルは冪等）。ベースラインは `../supabase/`（README の適用順）。

## 4. VM の AI ワーカー（systemd）

VM＝`claude-vm`（`seibot-proxy` / asia-northeast1-a）・`/mnt/claude-data/projects/photo-report-worker`。
**コード更新**（リポは git 管理外＝手動コピー）:

```bash
# ローカルから
gcloud compute scp --zone asia-northeast1-a --project seibot-proxy --tunnel-through-iap \
  worker/photo-report-worker.mjs claude-vm:/mnt/claude-data/projects/photo-report-worker/
# VM で
sudo systemctl restart photo-report-worker
systemctl status photo-report-worker --no-pager
```

初回の systemd 設置は `worker/README.md`（`photo-report-worker.service`・Restart=always・enable）。

## 5. JUST.DB 起動リンク（パラメータ）

```text
/report/photo?folderId={Drive写真フォルダID}&token={起動トークン}
```
- 旧 `/report/new?caseId=&investigationId=&constructionId=&driveFolderUrl=` は汎用プロトタイプ。パラメータ定義は `../architecture/justdb-supabase-integration.md`。
