# デプロイ配置メモ（どの資源がどこにあるか）

最終更新：2026-06-20
管理3面の「地図（台帳）」用。report-app を構成する**Google/クラウド側の資源の所在**を一覧化する。
（コードの構成は `architecture/repository-structure.md`、写真報告書の正本アーキは `architecture/slack-photo-report-architecture.md`）

## 所在一覧

| 資源 | 置き場 | 備考 |
|---|---|---|
| アプリ本体（Next.js） | Cloud Run **`report-app-justdb`**（`seibu-dispatch-poc-tky` / asia-northeast1） | `--no-allow-unauthenticated`＋**IAP** で社内限定。**memory 2Gi / cpu 2**（サーバーPDFの Chromium 用） |
| サーバーPDF用 Chromium | 同コンテナ内（Dockerfile で `chromium`＋`fonts-noto-cjk`＋`dumb-init`） | `/api/photo-report/pdf` が `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` で起動。VM ではなく Cloud Run（方式A） |
| サービスURL | `https://report-app-justdb-137338258930.asia-northeast1.run.app` | IAP 経由でのみ到達可 |
| OAuthクライアント（Drive読取） | `seibu-dispatch-poc-tky` | dispatch の既存クライアントを**流用**（client_id 先頭=プロジェクト番号 137338258930） |
| Drive API | `seibu-dispatch-poc-tky` で有効化 | 未有効だと 403 SERVICE_DISABLED |
| ワーカー用SA `report-worker-iap` | `seibu-dispatch-poc-tky` | 権限は **`iap.httpsResourceAccessor` のみ**（report-app への“通行証”）。**旧 Option B 用・現在未使用**（Option A＝worker が Drive 直書きで IAP 越え不要・D-DIGEST 項5） |
| Claude VM（AIワーカー実行） | **`seibot-proxy`**（別プロジェクト） | 汎用エージェントを顧客データPJから分離。**Option A 以降は mgmt-strat の Drive OAuth（`GOOGLE_DRIVE_REFRESH_TOKEN`＝RW）を保持し、Drive を直読み／直書き**（`_ai/digest.md` 等）。IAP は越えない |
| アプリのコード | GitHub `SeibuShodoku/report-app-justdb` | — |

## IAP アクセスモデル
- `roles/iap.httpsResourceAccessor` を付与済み：
  - `domain:seibu-s.co.jp`（社内ブラウザ＝Google SSO で `/report/photo` 閲覧）
  - `serviceAccount:report-worker-iap@seibu-dispatch-poc-tky.iam.gserviceaccount.com`（**旧 Option B の名残・現在未使用**。ダイジェスト生成は Option A＝Drive 直書きで IAP を越えない＝D-DIGEST 項5）
- IAP サービスエージェント `service-137338258930@gcp-sa-iap…` に `run.invoker` 付与済み。
- **外部ゲストの追加/削除**（社内SSOを持たない特定スタッフを社内アプリに入れる）：
  ```
  # 追加
  gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=report-app-justdb \
    --region=asia-northeast1 --project=seibu-dispatch-poc-tky \
    --member=user:<email> --role=roles/iap.httpsResourceAccessor
  # 削除（revoke）は add → remove に変えるだけ
  gcloud iap web remove-iam-policy-binding ... --member=user:<email> --role=roles/iap.httpsResourceAccessor
  ```
  - 前提：`<email>` は Google アカウント（Workspace/Gmail）であること。組織のドメイン制限共有（DRS）が効いていると外部 `user:` は弾かれる→組織管理者が許可リスト追加要（2026-06 時点では DRS 非適用で追加可だった）。
  - 注意：入れると**社内編集面フル（編集/保存可・削除は作成者本人のみ）＋顧客PIIに到達**。閲覧専用にはならない（見せるだけはリング1cの別サーフェス側）。ログイン後に特定の報告書へ着くには **launch token URL** を別途渡す（IAP通過だけではトップ止まり）。
  - 現在の付与者一覧＝`gcloud iap web get-iam-policy --resource-type=cloud-run --service=report-app-justdb --region=asia-northeast1 --project=seibu-dispatch-poc-tky`。

## 秘密の置き場
- **Cloud Run env**（report-app サーバー）：`GOOGLE_CLIENT_ID/SECRET`・`GOOGLE_DRIVE_REFRESH_TOKEN`・`SUPABASE_*`・`REPORT_LINK_SECRET`・`DRIVE_PROXY_SERVER_SECRET`（`--env-vars-file` で投入・ソースに焼かない）
- **ローカル開発**：`.env.local`（gitignore）
- **VM ワーカー**：`SUPABASE_*`・`GOOGLE_CLIENT_ID/SECRET`・`GOOGLE_DRIVE_REFRESH_TOKEN`（mgmt-strat RW＝Drive 直読み/直書き）・`CLAUDE_MODEL`/`CLAUDE_EFFORT`（既定 Opus 4.8/medium）・`MAX_*`/`POLL_INTERVAL_MS` 等（全一覧＝`worker/README.md`）。**Option A のため `report-worker-iap` SA鍵・`REPORT_APP_BASE` は不要**（旧 Option B の名残）

## 注意・将来
- `seibu-dispatch-poc-tky` は「dispatch + visit-planner + report-app」を抱える**共有プロジェクト**。同居の理由＝OAuthクライアント流用／請求枠上限で新規PJ不可／visit-planner と同構成。
- 厳密な分離が要るなら **report-app 専用プロジェクト**（自前OAuth・Cloud Run・SA・請求）が end-state（請求枠が空いたら寄せる）。
- デプロイ手順は `runbook/deploy.md`（Cloud Run／ワーカー systemd／migration）。Dockerfile は repo ルート。
