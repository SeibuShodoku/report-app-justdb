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
| Claude VM（AIワーカー実行） | **`seibot-proxy`**（別プロジェクト） | 汎用エージェントを顧客データPJから分離。**Option A 以降は mgmt-strat の Drive OAuth（`GOOGLE_DRIVE_REFRESH_TOKEN`＝RW）を保持し、Drive を直読み／直書き**（`_ai/digest.md` 等）。IAP は越えない。**worker 実体＝`/mnt/claude-data/projects/photo-report-worker/`（git checkout ではなくファイルコピー＝`git pull` 不可。更新は VM で `git clone --depth 1 git@github.com:SeibuShodoku/report-app-justdb.git` → `worker/photo-report-worker.mjs` を cp → `systemctl restart photo-report-worker`）。Claude 週次上限時は `CLAUDE_CONFIG_DIR_FALLBACK=~/.claude-acc2`(ishibashi) へ無言フォールバック（worker/README.md）** |
| アプリのコード | GitHub `SeibuShodoku/report-app-justdb` | — |
| 写真報告ジョブ `photo_report_jobs` | Supabase | `mode` 列（`full`/`summary`）で全生成／まとめだけ生成を分岐。追加 migration＝`docs/supabase/migrations/20260701120000_add_mode_to_photo_report_jobs.sql`（**本人がSQL適用**）。worker は `mode=summary` を `processSummaryJob`（写真DLなし・概要/内容のみ差替）で処理。 |

> **写真報告書ページの HTTP キャッシュ**：`/report/*` は `Cache-Control: no-store`（`next.config.ts` の headers()）。Slack/Gmail のアプリ内ブラウザが古い HTML＝古い CSS を握り、レイアウト崩れが直らない問題への対策。静的アセットは内容ハッシュ名なので長期キャッシュのまま。

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
  - **重要（2026-06-25 判明）：このプロジェクトの IAP OAuth 同意画面は `orgInternalOnly: true`＝内部（seibu-s.co.jp）限定。外部 `user:` の IAM 追加は通る（DRS 非適用）が、当該アカウントは IAP サインインを完了できない（Error code 9＝Failed OAuth redirect）。** ＝**外部ゲストは実質入れない**。社外アクセスは ①**seibu-s の Workspace アカウントを発行**（既存 consent で入れる）②**リング1c の IAP 外・署名付き読み取り専用URL** のどちらか。External 化は IAP OAuth Admin API 廃止（2026-03）＋共有PJ全体影響で非推奨。確認＝`gcloud iap oauth-brands list --project=seibu-dispatch-poc-tky`（`orgInternalOnly` を見る）。
  - 注意：入れると**社内編集面フル（編集/保存可・削除は作成者本人のみ）＋顧客PIIに到達**。閲覧専用にはならない（見せるだけはリング1cの別サーフェス側）。ログイン後に特定の報告書へ着くには **launch token URL** を別途渡す（IAP通過だけではトップ止まり）。
  - 現在の付与者一覧＝`gcloud iap web get-iam-policy --resource-type=cloud-run --service=report-app-justdb --region=asia-northeast1 --project=seibu-dispatch-poc-tky`。

## 秘密の置き場
- **Cloud Run env**（report-app サーバー）：`GOOGLE_CLIENT_ID/SECRET`・`GOOGLE_DRIVE_REFRESH_TOKEN`・`SUPABASE_*`・`REPORT_LINK_SECRET`・`DRIVE_PROXY_SERVER_SECRET`（`--env-vars-file` で投入・ソースに焼かない）
  - `PORTAL_ALLOWED_EMAILS`（秘密ではない・2026-07-02）＝案件ポータル `/portal` の試験運用 allowlist。**スペース区切り**の社内メール（カンマは gcloud の `--update-env-vars` 区切りと衝突するので使わない）。未設定なら IAP のみが門（社内全員）。判定は `security/case-access.ts` の staff 分岐。**現在4名（石橋/堀上/岡野/杉山）＝Slack 📋報告書ボタンの着地先**。
  - `REPORT_DIRECT_ALLOWED_EMAILS`（同上・2026-07-02）＝報告書直リンク `/report/photo?caseId=` の試験運用 allowlist（サーフェス別にポータルと別リスト・ポータルの新規作成リンクもここを通る）。書式・既定はポータルと同じ。現在4名（同上）。
- **ローカル開発**：`.env.local`（gitignore）
- **VM ワーカー**：`SUPABASE_*`・`GOOGLE_CLIENT_ID/SECRET`・`GOOGLE_DRIVE_REFRESH_TOKEN`（mgmt-strat RW＝Drive 直読み/直書き）・`CLAUDE_MODEL`/`CLAUDE_EFFORT`（既定 Opus 4.8/medium）・`MAX_*`/`POLL_INTERVAL_MS` 等（全一覧＝`worker/README.md`）。**Option A のため `report-worker-iap` SA鍵・`REPORT_APP_BASE` は不要**（旧 Option B の名残）

## 注意・将来
- `seibu-dispatch-poc-tky` は「dispatch + visit-planner + report-app」を抱える**共有プロジェクト**。同居の理由＝OAuthクライアント流用／請求枠上限で新規PJ不可／visit-planner と同構成。
- 厳密な分離が要るなら **report-app 専用プロジェクト**（自前OAuth・Cloud Run・SA・請求）が end-state（請求枠が空いたら寄せる）。
- デプロイ手順は `runbook/deploy.md`（Cloud Run／ワーカー systemd／migration）。Dockerfile は repo ルート。
