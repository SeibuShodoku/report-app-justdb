# 写真報告書 自動生成（Slack 起点）実装計画書 v0.2

最終更新：2026-06-20
状態：**Phase 1/2/3 prod稼働。Phase4 版管理・注記＝ブラウザE2E済。Phase5 堅牢化＝完了。Phase6 設定モーダル＋PDF体裁＝実装済（migration 適用済 2026-06-20）。Phase D1 案件ダイジェスト生成＝実装/E2E済 2026-06-20（Option A・worker 直書き）。Phase D2 digest-gas 切替＝2026-06-20 本番切替完了（統一正本モデル・旧 API 直叩き撤去＝API課金停止）。残＝JUST.DB本接続(予算)**
対象仕様（正本）：`../architecture/slack-photo-report-architecture.md`（本書はその実装手順）

## 0. 方針

- **依存順に積む**：WEB/BFF（画像プロキシ＋プリフィル）→ VM の AI ワーカー → GAS/Slack。
  WEB/BFF が動けば VM の AI 生成を**単体で検証**でき、Slack は最後に繋げる（壊れる面を切り分けられる）。
- **契約は実装後に抽出**（D-PORTS）。本計画では仕様 §6/§7 をスタブとして両側を並行可能にする。
- 各フェーズに**検証マイルストーン (M)** を置き、そこを通過してから次へ。

### 確定済みの基盤決定（正本＝アーキ §5/§8/§11）
- **現在版＝Supabase `photo_reports`（folder_id キー・1件のみ・上書き）**。**版履歴＝Drive `_ai/reports/<folder_id>/v*.json`（append-only）**を report-app が書く（ワーカーは readonly 据置）。
- ジョブ置き場：**Supabase テーブル**（`photo_report_jobs`）。
- Drive 資格情報：**社内ユーザーの OAuth refresh token**（dispatch-app 標準）。report-app=`drive`full(RW)／ワーカー=`drive.readonly`。※外部 SA は不可（実証 2026-06-18・§1a 参照）。
- トリガー：**トピックの「📸報告書」ボタン（block_actions）**。報告書の単位＝**写真サブフォルダ（`写真_YYYYMMDD`）**。
- **PDF はシステム非責務**（人が任意で印刷）。赤丸注記は**JSON重ね描き**（写真不変・版管理同梱）。

---

## フェーズ 1：WEB / BFF（`report-app-justdb`）★最初

### 1a. Drive 資格情報（社内ユーザー OAuth refresh token）

> **経緯（2026-06-18）**：当初 外部サービスアカウント(`report-drive-reader@seibot-proxy…`)で実装したが、
> Workspace は外部プリンシパルにフォルダ継承を波及させないため、フォルダ共有しても中の写真を読めなかった
> （個別ファイル共有なら読めたが自動化で非現実的）。dispatch-app と同じ**社内ユーザー OAuth**へ切替。
> コードは `src/lib/drive.ts` の `getAccessToken()` を refresh_token 交換に改修済み（REST 部は不変）。

**必要な入力（落ち着いてやる手順。dispatch-app `docs/gcp/gas_gcp_setup.md §3` と同じ流儀）:**
- [ ] **OAuth クライアントを用意**：既存の dispatch-app 用クライアントを流用してよい（`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`）。
- [ ] そのクライアントが属する **GCP プロジェクトで Drive API を有効化**（Calendar/Gmail と同様）。
- [ ] **refresh token を1本発行**：OAuth Playground（歯車→Use your own OAuth credentials → client_id/secret 入力）で
      scope = `https://www.googleapis.com/auth/drive.readonly` を指定し、**フォルダを読める社内アカウント（当面 mgmt-strat@seibu-s.co.jp）**で同意 → `Exchange authorization code for tokens` で refresh_token 取得。
      （既存の Calendar トークンに混ぜず、報告書用に独立発行する＝最小権限）
- [ ] **report-app の `.env.local` に設定**：`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_DRIVE_REFRESH_TOKEN` / `DRIVE_PROXY_SERVER_SECRET`。本番(Cloud Run)は同名の env を設定。`.env.example` 更新済み。
- [ ] **後片付け**：不要になった外部 SA `report-drive-reader@seibot-proxy.iam.gserviceaccount.com`（鍵含む）を削除、`.env.local` の旧 `GOOGLE_SA_KEY_JSON` 行を除去。OAuth 経路の疎通確認後に実施。

### 1b. 画像プロキシ
- [ ] `src/lib/drive.ts`：SA 認証の Drive REST 薄ラッパ（`files.list` / `files.get?alt=media`、`supportsAllDrives`）。`supabase-rest.ts` と同じく fetch ベース・サーバー専用。
- [ ] `src/app/api/folder/route.ts`：`GET ?folderId=` → 画像一覧 `[{fileId,name,mime,created}]`。
- [ ] `src/app/api/photo/route.ts`：`GET ?fileId=` → バイトをストリーム（Content-Type 付与、キャッシュ制御）。
- [ ] 認証出し分け：ブラウザ=`launch-token` 検証（`src/lib/security/launch-token.ts`／許可フォルダ外は 403）、VM=`DRIVE_PROXY_SERVER_SECRET` ヘッダ。
- [ ] （任意）プロキシ側でサムネ/リサイズ供給（vision コスト・表示速度）。

### 1c. report JSON 取り込み＋プリフィル
- [x] **report JSON スキーマ**：`src/schemas/photo-report.ts`（`photoReportDraftSchema`・Drive fileId 参照・枚数緩和）。
- [x] **プリフィル元ヘルパー**：`src/lib/photo-report-source.ts`（`imagesToView`/`loadPhotoReportView`/`photoProxyUrl`。当面フォルダ画像から素の下書きを合成）。
- [x] **写真報告書ページ**：`src/app/report/photo/page.tsx`（launchContext＋トークン検証→Drive 写真を `/api/photo` 経由で並べる。見出し/注記は当面空）。
- [x] **report JSON エンドポイント**：`src/app/api/photo-report/route.ts`（VM/再取得向け。当面フォルダ合成）。
- [x] **PDF（印刷）**：`src/components/print-button.tsx`＋`globals.css @media print`（A4・操作系除去・カードのページ跨ぎ防止）。
- [ ] （Phase 2 へ）`photo_report_jobs` と AI 生成 report JSON の **Supabase 保存**＝`loadPhotoReportView` の TODO で上書きする層。`docs/supabase/` に DDL 追記。
- [ ] （別 open-issue）赤丸注記の描画は本計画では未実装。

> 検証(2026-06-18)：typecheck/test(21)/lint 緑。:3000 実機で `/report/photo`(token無→アクセスエラー200)・`/api/photo-report`(Drive未設定503) を確認。**実写真表示は OAuth 認証情報(§1a)投入後に M1 として確定**。

> **M1（WEB 単体）**：手書きの report JSON ＋実フォルダで WEB URL を開く → Drive の写真がプリフィル表示され、PDF 保存できる。AI も Slack もまだ無し。
> **✅ 達成(2026-06-18)**：社内ユーザー OAuth(mgmt-strat・drive.readonly)＋OAuthクライアントのGCPプロジェクト(seibu-dispatch-poc-tky)でDrive API有効化 → 実Next(:3000)で `/api/folder`=52枚 / `/api/photo`=200 image/jpeg / `/report/photo`=全52枚プリフィル表示＋印刷ボタン、を確認。テストフォルダ=`1Xh3YpmburdGm98gOGZxsiuPb-VqlgLj3`。
> 要片付け：`.env.local` の `DRIVE_PROXY_SERVER_SECRET` 重複行（プレースホルダ）削除、`REPORT_LINK_SECRET` を本番前に実乱数へ。

---

## フェーズ 2：VM の AI ワーカー（VM 常駐 Claude）

コード＝`worker/photo-report-worker.mjs`（素の node・ビルド不要）。VM では `/mnt/claude-data/projects` にリポを置き tmux で常駐。

> **方式Y 確定(2026-06-19)**：Cloud Run 直結IAP がヘッドレス用 audience(client_id) を露出しない（旧OAuth Admin API廃止）ため、worker は IAP越しプロキシをやめ **Drive 直読み**に。案件フォルダは **mgmt-strat 所有ツリー配下**で、他者所有の写真も継承で読める（実測確認・DWD不要）。IAP はブラウザ閲覧の保護として維持。worker-IAP SA は撤去。

- [x] ジョブ取得：`photo_report_jobs` を Supabase REST でポーリング、status=eq.queued を条件付き PATCH で claim（多重取得防止）。
- [x] 写真取得：**Drive 直読み**（mgmt-strat OAuth refresh token・`files.list`/`files.get?alt=media`）で作業ディレクトリへDL（ファイル名=fileId）。
- [x] AI 生成：**VM の Claude Code をヘッドレス起動**（`claude -p …`・Team サブスク認証＝D-AIDATA・APIキー不要）で `report.json` を書かせる。
- [x] 検証＋保存：zod（`reportJsonSchema`＝`photo-report.ts`ミラー）で検証 → `photo_reports` に upsert、ジョブ done。失敗は error＋attempts++。
- [x] WEB 側：`loadPhotoReportView` が `photo_reports` の保存JSONを優先し `overlayReport` で見出し/注記/並び/要約を上書き（テーブル未作成でもフォルダ合成へフォールバック）。
- [x] DDL：`docs/supabase/slack-photo-report-schema.sql`（`photo_report_jobs` / `photo_reports`）。
- [ ] **実行（M2ブロッカー・外部）**：①DDLをSupabaseに適用 ②VMでリポ配置＋`claude`ログイン済み ③手動ジョブ投入 ④`node worker/photo-report-worker.mjs` 起動。Claude Code ヘッドレスのフラグはVMで `claude --help` を見て最終調整（worker/README.md）。

> 検証(2026-06-18)：worker `node --check`・typecheck・test(24)・lint 緑。実行通し（M2）は DDL適用＋VM上Claude Code が要るため未。

> **M2（Slack 抜き E2E）**：`photo_report_jobs` に手動で 1 行入れる → ワーカーが report JSON を生成 → M1 の WEB URL が **AI プリフィル**で開く。
> **✅ 達成(2026-06-19)**：VM(`/mnt/claude-data/projects/photo-report-worker`)で worker 起動→ジョブ(folder=テスト)を claim→**Drive直読み**で写真DL→**VMのClaude Codeをヘッドレス起動**(`claude -p --permission-mode acceptEdits`・実機検証済)→`report.json`(5件)生成→zod検証→`photo_reports` upsert→job done。AI出力は防鳥対策の専門的な見出し・所見・要約を生成（品質良好）。テストは MAX_PHOTOS=5。ページ閲覧はIAP(@seibu-s.co.jp SSO)越し。

---

## フェーズ 2.5：案件ダイジェスト統合（「口」）

詳細＝`../architecture/slack-photo-report-architecture.md` §7。要約“計算”は **VM ワーカーに一本化**、生成物は **ワーカーが Drive 直書き（Option A・D-DIGEST追補）**。

- [x] **Drive 書込スコープ準備**：`drive` full の refresh token を発行し Cloud Run の `GOOGLE_DRIVE_REFRESH_TOKEN` に設定（rev00002）。**2026-06-20：同 RW トークンを VM ワーカーへ流用**（digest 直書き用。RW を tokeninfo で確認）。
- [x] **「口」API（report-app）**：`POST/GET /api/case-digest`＋`src/lib/drive-write.ts`/`case-digest.ts`。実機でDrive操作検証済。※生成の書き戻しには使わない（IAP 非対応のため Option A）。GET 読取／非VM producer 用に存置。
- [x] **GD書類の既読索引**：digest.md 末尾マーカー `<!-- digest-read-doc-ids: … -->` で既読 fileId を保持し未読のみ新規に読む（`parseReadDocIds`/`withTailMarkers`／D2で `slack-absorbed-ts` カーソルも同居）。
- [x] **マッピング**：JUST.DB案件一覧（GOOGLE_DRIVE_URL / SLACK_THREAD_TS / SLACK_CHANNEL_ID / 案件ID）で案件↔フォルダ↔スレッドを解決（**Phase D2 で GAS が使用＝実装済**）。
- [x] **ワーカー切替（写真側）**：`_ai/digest.md` を folder_id→親 の順に Drive 直読みし、あれば文脈に（commit `feb2f58`）。実機検証済。
- [x] **ダイジェスト“生成”＝Phase D1（2026-06-20・E2E済）**：ジョブ `case_digest_jobs` → VM ワーカー（`processDigestJob`）が未読書類＋`slack_delta` をマージ要約 → **`_ai/digest.md`・`slack-summary-history.md` を直書き**＋`result_summary`。専用テストフォルダで検証（整形・既読マーカー・履歴・2キュー相乗り）。
- [x] **Phase D2＝digest-gas 切替（2026-06-20 本番切替完了）**：`topic-digest-gas` の Claude API 直叩きを撤去し `case_digest_jobs` へ投入→`result_summary` でトピック更新（統一正本モデル・API 課金停止）。
- [ ] **注意**：AI専用フォルダの mgmt 限定 ACL は、親フォルダ共有の継承との兼ね合いを実機確認して詰める。

> **M2.5（達成・D1）**：ジョブ投入 → AI専用フォルダに digest.md が生成 → 写真ワーカーがそれを文脈に使い、より正確な report JSON を生成。

---

## フェーズ 3：GAS / Slack（`justdb-hub-gas`）

経路：Slack → `seibot-proxy`（署名検証）→ hub-gas。3 秒 ACK 厳守。実装＝`photo_report_actions.gs`（block_actions の pr_*）。

### 3a. 入口（✅ prod 稼働 2026-06-19）
- [x] トピックに「📸報告書」ボタン：`SlackMessageRouting.gs generateInquiryInitialBlocks`（正本）＋ `topic-digest/topicBlocks.gs`（regenerate複製・同期）。value=`{caseId, driveFolderUrl}`（GD URL は JUST.DB案件一覧 `field_1709884614` 由来）。
- [x] block_actions 振り分け：`security_proxy.gs` → `handlePhotoReportAction_`（**テスター以外は即 return**・Script Property `PHOTO_REPORT_TESTERS`）。
- [x] `pr_start`：スレッドに GD URL＋[⚙️設定][📝報告書作成]。`pr_create`：GD URL→folder_id→`photo_report_jobs` INSERT（409=既投入）。`pr_settings`：プレースホルダ。
- [x] デプロイ：hub-gas=**prod 新バージョン**（block_actions の `/exec` 固定URL維持）。topic-digest=**clasp push のみ**（cron駆動・WebApp/デプロイ不要・README明記）。Script Properties 設定済（コード経由 `pr_setupProps` でGUI 50件制限を回避）。

### 3b. 写真サブフォルダ化（✅ prod 稼働・E2E検証 2026-06-19・hub-gas `a07d64c`）＝アーキ §4
- [x] `pr_start`：トップ案件フォルダ配下に **`写真_YYYYMMDD`(JST) を find-or-create**（`pr_ensurePhotoSubfolder_`・DriveApp）→ 本文リンク・ボタン value の `driveFolderUrl` を**サブフォルダ**に。
- [x] **同日2回目以降の `pr_start`＝エフェメラル案内**（既存サブフォルダ検知時。公開投稿を増やさない・作成はスレ既出ボタンから）。
- [x] `pr_create`：**done/error の既存ジョブは再投入（`pr_reenqueueIfFinished_` が status=queued に戻す＝再生成）**、queued/processing はガード。
- 実機検証: 新サブフォルダjob=4(5枚)生成→done / 2回目クリック=エフェメラル / 完了後の再クリック=再投入(attempts2)。

### 3c. 完了返信（✅ prod 稼働・E2E検証 2026-06-19・hub-gas `fd612b5`）
- [x] done 検知：`pr_notifyDoneJobs`（1分毎の時間主導トリガー・`pr_installNotifyTrigger` で設置）が `status=done & notified_at=null` を拾い、スレッドへ「📝報告書を開く」**ボタン**を投稿→`notified_at` セット（重複防止）。再投入時は `notified_at` を null に戻し再通知。
- [x] URL発行：`pr_open` がクリック時に **GASで launch token を HMAC 生成**（`pr_makeReportUrl_`・`REPORT_LINK_SECRET` は Cloud Run と同値・既定24h）→ 本人にエフェメラルで渡す（**生URLを焼かず期限切れ回避**）。この部品は将来のトピック導線でも共用可。
- 前提: migration `add_notified_at_to_photo_report_jobs`（§4 参照）／hub-gas Script Property `REPORT_LINK_SECRET`。

> **M3（フル E2E）**：トピック「📸報告書」→ 写真をサブフォルダへ → 「📝報告書作成」→ スレッドに完成URL（ボタン）。現場が URL を開いて赤丸・微修正・版管理。

---

## フェーズ 4：版管理・注記（report-app 編集面）＝アーキ §5/§6（✅実装/静的検証済 2026-06-19・ブラウザ/Drive E2E待ち）

- [x] **スキーマ予約**：`src/schemas/photo-report.ts` に `annotationSchema`＋各写真 `annotations: z.array(...).default([])`。`photo-report-source.ts`（View/Stored/overlay）と worker ミラー schema まで貫通＝版互換。テスト追加。
- [x] **版スナップショット**：保存時に `_ai/reports/<folder_id>/v{連番}.json`（append-only・不変・自己記述）を Drive へ書く＋ `photo_reports` を差替。
  - `src/lib/report-versions.ts`（純粋：版名 parse/format/next・自己記述ファイル組立・単体テスト）／`drive-write.ts`（`getParentId`・`resolveReportVersionsDir`・`listFolderFiles`・`createTextFile`＝新規作成のみ＝不変・`readTextFileById`）／`photo-report-store.ts`（`saveReportVersion`/`listReportVersions`/`rollbackToVersion`）／`supabase-rest.ts` に `sbUpsert`。
  - `POST /api/photo-report/save`（起動トークン認可・案件/フォルダIDは認可済み値を権威に上書き）。
- [x] **ロールバック UI**：版一覧（`GET /api/photo-report/versions`）→ 選んだ旧版の内容で**新版を書く**（`POST /api/photo-report/rollback`・1版＝監査）。編集面は再読込で最新を反映。
- [x] **版名・削除**：版名＝Drive `description`（保存時付与＋一覧から後編集 `POST /api/photo-report/rename`・**本文＝報告内容は不変**）。削除＝Drive ゴミ箱（`POST /api/photo-report/delete`・復元可・**最新版は不可**＝現在版/連番起点）。`drive-write.ts` に `setFileDescription`/`trashFileById`、`createTextFile` に description/appProperties 対応。
- [x] **削除は作成者本人のみ**：作成者＝**IAP メール**（`security/iap-user.ts`）を保存/ロールバック時に版JSON `createdBy`＋Drive `appProperties.createdBy` に記録。削除時にサーバーで照合（他人＝403）。UI も他人の版は削除ボタン無効化。旧版（未記録）／IAP なしのローカルは非制限。
- [x] **注記 UI**：`src/components/photo-annotator.tsx`。写真上の透明 SVG＋Pointer Events（マウス/指/ペン）。赤丸/囲み/矢印/線/手書き/テキスト、色、選択/削除、UNDO/REDO（配列 push/pop）。座標=0〜1正規化（実表示boxを ResizeObserver で測り均一px空間で描画）。`PhotoReportEditor` に統合・保存に同梱。
- [x] **編集面**：`src/components/photo-report-editor.tsx`（クライアント島）＝見出し/所見/全体要約/並び替え＋保存/版/印刷。`/report/photo` は server で auth＋ロード→島へ渡す。
- [ ] **残＝E2E（人の通し）**：実フォルダで `/report/photo` を開き、編集→保存→Drive に v0001.json／Supabase 現在版差替→版一覧→ロールバック→赤丸描画→保存→印刷、を実データ1件で確認（要 Cloud Run デプロイ or ローカル creds）。

## フェーズ 6：報告書設定・PDF体裁（✅実装/静的検証済 2026-06-19・要 migration＋通し）＝アーキ §6.5

ゴール＝齋藤マンション様 PDF。設定で AI 文章のトーンと報告書メタを制御し、印刷を PDF 体裁に寄せる。

- [x] **データ層**：`photo_report_settings`（folder_id・種類/実施日/物件名/担当者/トーン4種）migration＋RLS。report JSON に `workItems`（施工内容）追加（worker mirror 含む）。
- [x] **API**：`/api/photo-report/settings`（GET/POST・browser auth）／`/api/photo-report/generate`（job 投入/再投入・browser auth）。
- [x] **設定モーダル UI**：`/report/photo` の⚙️設定モーダル（種類/実施日/物件名/担当者/文体/対応/提案/相手）＋「AIで再作成」。`workItems`・概要も編集可。
- [x] **worker プロンプト反映**：`getSettings`＋`settingsLines`で種類/文体/対応/提案/法人個人を指示。見出し≤20字・所見省略・`workItems`生成。
- [x] **PDF 体裁（print CSS）**：表紙（種類タイトル/実施日/施工現場/会社フッター城東支店）→番号付き2列グリッド（見出しのみ）→最終ページ（概要/内容/免責＝`lib/report-template.ts`）。
- [ ] **要 migration 適用**：`migrations/20260619210000_create_photo_report_settings.sql` を Supabase に。**通し**：設定保存→AIで再作成→PDF 体裁を実データで確認。
- [ ] **残**：Slack「⚙️設定」のURL発行導線（hub-gas）・物件名の JUST.DB ライブ取得。

## フェーズ 5：堅牢化・締め

- [ ] 部分失敗のリトライ、attempts 上限。
- [ ] 画像前処理（リサイズ/圧縮）の置き場確定（プロキシ or ワーカー）。
- [ ] 監査ログ（作成者・日時・案件ID・folderId）＝`requirements.md` §6。
- [ ] 完成 UX（進捗表示・最新版へのリンク）。
- [ ] ワーカーの自動再起動（現状 tmux 手動・systemd/respawn 化）。
- [ ] （任意）JUST.DB 限定書き戻し（金額/回数/薬剤/要約）。`open-issues.md` §0 の 5000/日 予算が解けてから。
- [ ] **契約抽出**：稼働中の画像プロキシ＋report JSON 取り込み＋`_ai/` 書込みから `*_CONTRACT.md` を本アプリ `docs/` に抽出し、[`PORTS.md`](../../../PORTS.md) §5 に登録（D-PORTS）。

---

## 依存・並行
- 1 → 2（ワーカーは画像取得＝当初プロキシ／確定後は Drive 直読みに依存）。
- 3a（入口）は完了。3b/3c は hub-gas 内で完結し並行可。
- 4（版管理/注記）は report-app 単体で進められ、3c（完了返信）と独立。
- 1a（Drive 資格＝社内 OAuth）は全段の前提でクリティカルパス。※当初の外部 SA 案は実証の上で破棄（§1a）。

## 検証の通し方
- M1：WEB 単体（AI/Slack 無し）。
- M2：Slack 抜き E2E（手動ジョブ）。
- M3：フル E2E。
- 各 M で「写真が出る／JSON が valid／URL が開く／（人が）印刷できる」を実データ 1 件で確認。

## リスク・要注意
- **3 秒 ACK**（§5）：ボタン処理を同期で重くしない。必ず ACK→非同期。
- **D-AIDATA 条件**：ワーカーの Claude を消費者プランに落とさない（Team/API 固定）。
- **権限境界**：プロキシのトークン検証を必ず通す（顧客写真が無制限露出しないよう、フォルダ外 403）。
- **JUST.DB 予算**：本フローで JUST.DB を不用意に叩かない（Drive+Supabase+AI で完結させる）。

## 関連
- 仕様（正本）：`../architecture/slack-photo-report-architecture.md`（簡易版＝`slack-photo-report-simple.md`）
- 既存：`spec/requirements.md` / `spec/report-formats.md` / `architecture/overview.md` / `architecture/justdb-supabase-integration.md`
- 横断：[`decisions.md` D-AIDATA / D-PORTS](../../../decisions.md) / [`PORTS.md`](../../../PORTS.md)
- 基盤：`GCP_VM_Claude_構築手順.md` / `slack-mini-bolt` / `seibot-proxy`
