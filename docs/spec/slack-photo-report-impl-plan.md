# 写真報告書 自動生成（Slack 起点）実装計画書 v0.1

最終更新：2026-06-18
状態：**draft**
対象仕様：`spec/slack-photo-report.md`（本書はその実装手順）

## 0. 方針

- **依存順に積む**：WEB/BFF（画像プロキシ＋プリフィル）→ VM の AI ワーカー → GAS/Slack。
  WEB/BFF が動けば VM の AI 生成を**単体で検証**でき、Slack は最後に繋げる（壊れる面を切り分けられる）。
- **契約は実装後に抽出**（D-PORTS）。本計画では仕様 §6/§7 をスタブとして両側を並行可能にする。
- 各フェーズに**検証マイルストーン (M)** を置き、そこを通過してから次へ。

### 着手前に潰す最小の決定（仕様 §10 のうち着手必須のもの）
- report JSON 置き場：**まず Supabase**（本アプリが既に接続・実装が速い）。Drive 再編集 JSON への移行は後（migrate-on-touch）。
- ジョブ置き場：**Supabase テーブル**（`photo_report_jobs`）。
- Drive 資格情報：**社内ユーザーの OAuth refresh token**（dispatch-app 標準）。※外部 SA は不可（実証 2026-06-18・§1a 参照）。
- トリガー：**メッセージショートカット**（スレッド ts を確実に取得）。
- ↑は提案。確定後にこの節を更新する。

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
- [ ] **report-app の `.env.local` に設定**：`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_DRIVE_REFRESH_TOKEN` / `DRIVE_PROXY_SERVER_SECRET`。本番(Vercel)は同名の env を設定。`.env.example` 更新済み。
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

設置：`/mnt/claude-data/projects/photo-report-worker`（永続ディスク）。**Google 資格情報は持たない**。

- [ ] ジョブ取得：`photo_report_jobs` を Supabase REST でポーリング（status=queued）。冪等キー＝`(channel,thread_ts,folderId)`。
- [ ] 写真取得：WEB の `/api/folder`→`/api/photo`（`DRIVE_PROXY_SERVER_SECRET`）でバイト取得。Drive は触らない。
- [ ] AI 生成：Claude（**Team/API 認証**＝D-AIDATA）で写真＋スレッド文脈 → report JSON（`heading`/`annotationNote`/並び/`headerSummary`）。スキーマに valid であること（zod 相当で検証）。
- [ ] 保存：report JSON を Supabase に書き、ジョブを done に。失敗は error＋再実行可能に。
- [ ] 常駐：tmux で起動（`GCP_VM_Claude_構築手順.md` §11）。落ちたら再開できるよう状態は Supabase 側に。

> **M2（Slack 抜き E2E）**：`photo_report_jobs` に手動で 1 行入れる → ワーカーが report JSON を生成 → M1 の WEB URL が **AI プリフィル**で開く。

---

## フェーズ 3：GAS / Slack（`slack-mini-bolt` 資産）

経路：Slack → `seibot-proxy`（署名検証）→ GAS。3 秒 ACK 厳守。

- [ ] トリガー（メッセージショートカット）受信ハンドラ：即 ACK。
- [ ] Drive フォルダ作成：`driveUtils.gs`。トピックの親フォルダ配下に命名規則で子フォルダ（要・命名規則確定）。
- [ ] スレッド投稿：`slackClient.gs` で「📁<フォルダリンク> に写真を保存 → [報告書を作成] ボタン」。
- [ ] ボタン（`block_actions`）ハンドラ：即 ACK →「作成中…」→ `photo_report_jobs` に投入（channel/thread_ts/folderId/caseId）。
- [ ] 完了反映：ワーカー done を検知（GAS 側ポーリング or WEB からの通知）→ スレッドへ **WEB URL** を `chat.update`/新規投稿。
- [ ] 設定はシート正本（`slack-mini-bolt` 流儀）。stg は DRY_RUN。

> **M3（フル E2E）**：Slack でトリガー → 写真を Drive へ → ボタン → スレッドに完成 WEB URL。現場が URL を開いて赤丸・PDF。

---

## フェーズ 4：堅牢化・締め

- [ ] 冪等/再生成（再押下で最新写真で上書き）、部分失敗のリトライ。
- [ ] 画像前処理（リサイズ/圧縮）の置き場確定（プロキシ or ワーカー）。
- [ ] 監査ログ（作成者・日時・案件ID・folderId）＝`requirements.md` §6。
- [ ] 完成 UX（進捗表示・PDF リンク）。
- [ ] （任意）JUST.DB 限定書き戻し（金額/回数/薬剤/要約）。`open-issues.md` §0 の 5000/日 予算が解けてから。
- [ ] **契約抽出**：稼働中の画像プロキシ＋report JSON 取り込みから `*_CONTRACT.md` を本アプリ `docs/` に抽出し、[`PORTS.md`](../../../PORTS.md) §4 に登録（D-PORTS）。

---

## 依存・並行
- 1 → 2（ワーカーはプロキシに依存）。
- 3 は **ジョブ置き場スキーマ（1c）確定後**ならスタブジョブ相手に並行着手可。E2E は 1+2 完了後。
- 1a（SA）は 1b の前提でクリティカルパス。最初に片付ける。

## 検証の通し方
- M1：WEB 単体（AI/Slack 無し）。
- M2：Slack 抜き E2E（手動ジョブ）。
- M3：フル E2E。
- 各 M で「写真が出る／JSON が valid／URL が開く／PDF が出る」を実データ 1 件で確認。

## リスク・要注意
- **3 秒 ACK**（§5）：ボタン処理を同期で重くしない。必ず ACK→非同期。
- **D-AIDATA 条件**：ワーカーの Claude を消費者プランに落とさない（Team/API 固定）。
- **権限境界**：プロキシのトークン検証を必ず通す（顧客写真が無制限露出しないよう、フォルダ外 403）。
- **JUST.DB 予算**：本フローで JUST.DB を不用意に叩かない（Drive+Supabase+AI で完結させる）。

## 関連
- 仕様：`spec/slack-photo-report.md`
- 既存：`spec/requirements.md` / `architecture/overview.md` / `architecture/justdb-supabase-integration.md`
- 横断：[`decisions.md` D-AIDATA / D-PORTS](../../../decisions.md) / [`PORTS.md`](../../../PORTS.md)
- 基盤：`GCP_VM_Claude_構築手順.md` / `slack-mini-bolt` / `seibot-proxy`
