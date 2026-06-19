# デプロイ配置メモ（どの資源がどこにあるか）

最終更新：2026-06-19
管理3面の「地図（台帳）」用。report-app を構成する**Google/クラウド側の資源の所在**を一覧化する。
（コードの構成は `architecture/repository-structure.md`、写真報告書の正本アーキは `architecture/slack-photo-report-architecture.md`）

## 所在一覧

| 資源 | 置き場 | 備考 |
|---|---|---|
| アプリ本体（Next.js） | Cloud Run **`report-app-justdb`**（`seibu-dispatch-poc-tky` / asia-northeast1） | `--no-allow-unauthenticated`＋**IAP** で社内限定 |
| サービスURL | `https://report-app-justdb-137338258930.asia-northeast1.run.app` | IAP 経由でのみ到達可 |
| OAuthクライアント（Drive読取） | `seibu-dispatch-poc-tky` | dispatch の既存クライアントを**流用**（client_id 先頭=プロジェクト番号 137338258930） |
| Drive API | `seibu-dispatch-poc-tky` で有効化 | 未有効だと 403 SERVICE_DISABLED |
| ワーカー用SA `report-worker-iap` | `seibu-dispatch-poc-tky` | 権限は **`iap.httpsResourceAccessor` のみ**（report-app への“通行証”・Drive/GCPリソース権限なし） |
| Claude VM（AIワーカー実行） | **`seibot-proxy`**（別プロジェクト） | 汎用エージェントを顧客データPJから**意図的に分離**。Google資格情報は持たない（IAP通行証SAの鍵のみ後置） |
| アプリのコード | GitHub `SeibuShodoku/report-app-justdb` | — |

## IAP アクセスモデル
- `roles/iap.httpsResourceAccessor` を付与済み：
  - `domain:seibu-s.co.jp`（社内ブラウザ＝Google SSO で `/report/photo` 閲覧）
  - `serviceAccount:report-worker-iap@seibu-dispatch-poc-tky.iam.gserviceaccount.com`（ヘッドレスのワーカーが OIDC で通過）
- IAP サービスエージェント `service-137338258930@gcp-sa-iap…` に `run.invoker` 付与済み。

## 秘密の置き場
- **Cloud Run env**（report-app サーバー）：`GOOGLE_CLIENT_ID/SECRET`・`GOOGLE_DRIVE_REFRESH_TOKEN`・`SUPABASE_*`・`REPORT_LINK_SECRET`・`DRIVE_PROXY_SERVER_SECRET`（`--env-vars-file` で投入・ソースに焼かない）
- **ローカル開発**：`.env.local`（gitignore）
- **VM ワーカー**：`report-worker-iap` のSA鍵＋`SUPABASE_*`・`REPORT_APP_BASE`・`DRIVE_PROXY_SERVER_SECRET`

## 注意・将来
- `seibu-dispatch-poc-tky` は「dispatch + visit-planner + report-app」を抱える**共有プロジェクト**。同居の理由＝OAuthクライアント流用／請求枠上限で新規PJ不可／visit-planner と同構成。
- 厳密な分離が要るなら **report-app 専用プロジェクト**（自前OAuth・Cloud Run・SA・請求）が end-state（請求枠が空いたら寄せる）。
- デプロイ手順は `runbook/deploy.md`（Cloud Run／ワーカー systemd／migration）。Dockerfile は repo ルート。
