# 写真報告書システム アーキテクチャ（統合・現況）

最終更新：2026-06-19
本書は「Slack写真→AI写真報告書」システムの**現時点の正本（アーキ＋仕様）**。実装手順は
`spec/slack-photo-report-impl-plan.md`、資源の所在は `deployment.md`、報告書フォーマットは
`spec/report-formats.md`。横断方針は root `decisions.md`（D-AIDATA / D-DIGEST / D-PORTS）。
初期仕様は `archive/slack-photo-report-spec-v0.1.md`（本書が上書き済）。

## 1. 目的
案件の現場写真から、AI が**写真報告書の下書き**を作る。人は WEB で赤丸・微修正し、**版管理（ロールバック）**しながら仕上げる。
精度は「写真だけ」に頼らず、**案件の文脈（GD書類＋Slackスレッド要約）**で補う。
**PDF はシステムの責務ではない**（残したい人がブラウザから任意で印刷・保管する）。

## 2. コンポーネントと責務

| コンポーネント | 置き場 | 責務 |
|---|---|---|
| **report-app（WEB/BFF）** | Cloud Run `report-app-justdb`＋**IAP**（@seibu-s.co.jp）/ seibu-dispatch-poc-tky | 写真報告書の表示・編集・**版管理**（`/report/photo`）。画像プロキシ（`/api/folder`・`/api/photo`）。report JSON 取込（`photo_reports`）。**Drive書込み（RW保有）＝版スナップショット・案件ダイジェスト「口」** |
| **AIワーカー** | VM（seibot-proxy）`/mnt/claude-data/projects/photo-report-worker` 常駐（tmux `photo-worker`） | `photo_report_jobs` を拾い、**Drive直読み（readonly）**で写真取得→**VMのClaude Code(headless)**で report.json 生成→`photo_reports` 保存。**Drive書込みはしない** |
| **案件ダイジェスト要約** | 既存 `justdb-hub-gas/justdb-topic-digest-gas`（GAS・cron） | JUST.DB案件履歴ポーリング→案件スレッドを Claude で**マージ要約**→トピック備考更新。**要約の責務を一本化** |
| **Slackトリガー（hub-gas）** | `justdb-hub-gas/justdb-hub-gas`（GAS・block_actions） | トピックの「📸報告書」ボタン→スレッドに写真用サブフォルダURL＋[設定][報告書作成]→ジョブ投入 |
| **Supabase** | 既存 | `photo_report_jobs`（ジョブ台帳）/ `photo_reports`（**現在版1件のみ**・folder_id キー） |
| **JUST.DB** | 既存 | 正本。案件一覧に **案件ID・GoogleDrive URL・Slack thread_ts/channel** を保持＝**案件↔フォルダ↔スレッドのマッピング正本**（`field_1709884614`=GD URL ほか） |
| **Slackトピック（案件スレッド）** | 既存 | 1案件1スレッド。案件ID・GD URL が必ず記載。写真報告のトリガー起点 |
| **Google Drive** | 既存 | 案件フォルダ（mgmt-strat 所有ツリー）。配下に **写真用サブフォルダ**（写真のみ）と **`_ai/`（AI管理・mgmt限定ACL）**＝digest.md・slack履歴md・**report 版履歴** |

## 3. データフロー（全体）

```
[Slack案件スレッド/トピック]
   │ 「📸報告書」クリック (hub-gas: block_actions)
   ▼
 pr_start: 案件GDフォルダ配下に 写真サブフォルダ(写真_YYYYMMDD) を find-or-create
   │  → スレッドに「📁<サブフォルダ> に写真を保存」＋[⚙️設定][📝報告書作成]
   │  （同日の再クリックはエフェメラルで案内・公開投稿は増やさない）
   ▼
[写真サブフォルダ/写真]  ← 現場が写真をここへ（訪問ごとに分離・混ざらない）
   │ 「📝報告書作成」クリック → pr_create: photo_report_jobs に INSERT
   │   （done/error の既存ジョブは再投入＝再生成 / queued・processing はガード）
   ▼
[photo_report_jobs]──▶ AIワーカー(VM): Drive直読みで写真＋文脈(_ai/digest.md or 親フォルダPDF)取得
                                 →Claude Code(headless)→ report.json（写真ごとの見出し/注記/annotations枠/要約）
                                 └─▶ [photo_reports]（現在版1件・上書き）
                                          │
            ┌─────────────────────────────┘ 完了返信(予定): 最新報告書URLをスレッドへ1本
            ▼
[report-app /report/photo]（IAP/SSO）: 人が赤丸・微修正・並べ替え
   │ 保存/ロールバック
   ├─▶ [photo_reports] 現在版を差替（＝Slackリンク先も最新版に）
   └─▶ [Drive _ai/reports/<folder_id>/v0001.json …] 版を追記（append-only・report-appが書く）
```

## 4. 写真取込と「写真サブフォルダ」（訪問単位の分離）
- **報告書の単位＝写真サブフォルダ**（`写真_YYYYMMDD`）。folder_id がそのままジョブ・`photo_reports` のキー。
- トップ案件フォルダに写真を直置きしない（複数回訪問で混ざるため）。**「📸報告書」クリック時にサブフォルダを find-or-create**（同名=日付があれば再利用）し、その**サブフォルダURL**を「写真を保存してください」のリンク先にする。
- **同日2回目以降のクリック＝エフェメラル**で「写真はこのフォルダへ／編集は報告書URLで」を本人にだけ案内（公開投稿・フォルダ乱立を防ぐ）。
- 命名は当面 **日付ベース**。将来 ⚙️設定（報告書種類＝提案/初回契約履行/メンテナンス/その他）と組み合わせ `初回契約履行_YYYYMMDD` 等に発展可。
- 文脈は**親フォルダ**から拾えるため精度は維持：ワーカーは folder_id（サブ）の写真＋**親フォルダ**のPDF／親 `_ai/digest.md` を読む。

## 5. 永続と版管理
- **現在版＝Supabase `photo_reports`（folder_id キー・1件のみ・上書き）**。Slack リンク先は常にこの現在版を表示。
- **版履歴＝Drive `_ai/reports/<folder_id>/v0001.json, v0002.json …`（append-only）**。
  - 各版の**報告内容（JSON本文）は書いたら不変**（過去版の本文を書き換えない＝履歴の完全性／同時編集での破壊を回避）。最新＝最大番号。
  - **保存** → `v{次番号}.json` を追記 ＋ Supabase を上書き。**ロールバック** → 旧版の内容で `v{次番号}.json` を**新規に書く** ＋ Supabase 更新（ロールバックも1版として記録＝監査に強い）。
  - 各版ファイルは自己記述（`version`/`generated_at`/`source`=ai|human/`createdBy`/`note`/`folderName`/`report`）。可変なインデックスファイルは持たない。
  - **作成者＝IAP の認証メール**を保存/ロールバック時に記録（版JSON `createdBy`＝不変の監査／Drive `appProperties.createdBy`＝一覧で安く取れる判定用）。
  - **版名（ラベル）＝Drive ファイルの `description`（メタデータ）**。人が保存時に付与・後から編集可。**本文は触らないので不変性を保つ**。一覧は `files.list` で安く取れる（本文を読み直さない）。
  - **削除＝Drive ゴミ箱（trashed・復元可）**。物理削除しない＝「人の自己責任の例外」を可逆に留める。
    - **最新版（＝現在版・連番の起点）は削除不可**（消すなら先に別版へ戻す）。中間版の欠番は許容（連番は最大＋1で単調）。
    - **作成者本人のみ削除可**（サーバーで `createdBy` と IAP メールを照合・UI も他人の版は無効化）。作成者未記録の旧版／IAP なしのローカルは制限しない。
  - **書くのは report-app**（RW トークン保有）。**ワーカーは readonly のまま**＝VM→Cloud Run の IAP 越え不要・権限拡大なし。
- **PDF はシステムでは生成・保管しない**。人が WEB から任意で印刷。複数報告書の取り回し・恒久保管は人の運用（PDF）に委ねる。

## 6. 赤丸など注記（annotations）
- 写真ピクセルは**編集しない**。赤丸・矢印・線・フリーハンド・テキストは**JSONのオーバーレイ**として持つ（`report-formats.md` §3）。
  - 入力＝**Pointer Events**（マウス/指/ペン統一）、描画＝写真上の**透明SVGレイヤー**（ベクター・各図形が要素＝選択/削除容易・印刷でも崩れない）。
  - 座標は**0〜1の正規化値**（表示サイズ・プロキシのリサイズに非依存で写真にピタリと重なる）。
  - 基本図形は**画像ファイル不要**（幾何データのみ）。再利用スタンプを使う時だけ `{type:"stamp", asset:"名前", …}` で名前参照。
- スキーマ予約：`photoReportDraftSchema` の各写真に **`annotations: []`** を持たせる（UI は後フェーズでも、版に乗るよう先に予約）。
- UNDO/REDO は配列の push/pop＝**画像UNDOの煩雑さなし**。注記は report JSON の一部なので**版管理に自動で乗り、ロールバックで赤丸も一緒に戻る**。

## 6.5 報告書の設定（種類・トーン）とPDF体裁
ゴール体裁＝**齋藤マンション様 PDF**（表紙→番号付き写真グリッド→最終ページ）。

- **設定＝folder_id 単位・Supabase `photo_report_settings`**：報告書の種類(調査/施工)・実施日(当面手入力)・物件名(将来 JUST.DB 取得)・担当者＋**AI 文章のトーン**(ですます/言い切り・通常/クレーム・提案重要度しっかり/普通/軽め・法人/個人)。
- **設定 UI ＝ WEB 報告書ページ `/report/photo` の⚙️設定モーダル**（リッチ UI・JUST.DB 取得もサーバー側）。保存＝`POST /api/photo-report/settings`。Slack 「⚙️設定」はこのページURLを発行する導線（実装は後追い）。
- **生成**＝Slack「📝報告書作成」 or WEB「AIで再作成」(`POST /api/photo-report/generate` が `photo_report_jobs` を投入/再投入)。**VM ワーカーが設定を読み Claude プロンプトへ反映**（種類/文体/対応/提案/法人個人）。見出しは**全角20字以内**・所見は基本省略・**`workItems`(施工内容)** と `headerSummary`(概要) を生成。
- **出力体裁（印刷=PDF・report-app の print CSS）**：表紙（種類タイトル「施工報告書/調査報告書」・{種類}実施日・{種類}現場・会社フッター＝城東支店定型＋担当者）→ **番号付き2列グリッド**（「N．見出し」のみ）→ 最終ページ（{種類}概要＝`headerSummary` / {種類}内容＝`workItems` 番号付き / **免責事項**＝定型 `lib/report-template.ts`）。PDF 生成はブラウザ印刷（システムは PDF を保管しない）。
- 物件名の **JUST.DB ライブ取得**は API 予算（`open-issues §0`）が解けてから（当面モーダル手入力・将来 §3 Lane B の 1件 GET）。

## 7. 案件ダイジェスト統合（役割分担）— D-DIGEST / Phase D1 実装・E2E済（2026-06-20）/ Phase D2 統一正本モデル（2026-06-20 本番切替完了・旧 Claude API 直叩き撤去）
> **D2 統一正本モデル**：正本＝AI製 `digest.md`（重要情報（固定）／経緯（時系列）／既読書類索引）。生Slackは Supabase ジョブ `slack_delta` で渡す**短命データ**（畳み込み後 null 破棄）。**カーソルも AI 所有**＝既読書類ID＋吸収済 Slack ts を digest.md 末尾に同居（ジョブ `absorbed_ts` は GAS が読む写し）。**トピック備考＝固定的な重要情報カード**（`result_summary`・構造化データは除外）。GAS は要約せず **投入(enqueue)＋適用(apply)の2フェーズ I/O 専従**（`TOPIC_DIGEST_USE_VM` で旧経路と並走→撤去で API課金停止）。詳細＝中央契約 `contracts/case-digest/`。
- **要約“計算”は VM AI ワーカーに一本化**（GAS の Claude API 直叩きをやめる）。GAS は継ぎ目（Slack/JUST.DB トリガー・増分スレ本文の取得・トピック更新）に専念。ジョブ＝Supabase `case_digest_jobs`（GAS が投入／VM が claim）。
- **生成物の書き戻し＝ワーカーが Drive へ直書き（Option A）**：`_ai/` を find-or-create し `digest.md`(コア) と `slack-summary-history.md`(時系列履歴) を upsert。トピック要約は `case_digest_jobs.result_summary` へ書き、GAS がポーリングして反映（IAP 越え不要）。
  - 当初は report-app「口」`/api/case-digest` 経由を想定したが、**統合（直）Cloud Run IAP がプログラム的 OIDC audience を受け付けない**（VM から実測：run.app URL／ブラウザ共有クライアント／プロジェクト所有 OAuth クライアント等すべて `Invalid JWT audience`）→ Option A に切替（D-DIGEST 追補）。digest は **AI 所有・人非接触**で「口一本」の監査根拠が薄く、ワーカー直書きで十分。「口」は GET 読取り／非VM producer 用に存置。
- **GD書類は“一度読んだら既読”**：digest.md 末尾の機械可読マーカー `<!-- digest-read-doc-ids: … -->` に既読 fileId を保持し、**未読のみ新規に読む**（トークン安定・D-DIGEST「欲張らない」）。コアmdには索引（名前・日付・種別＋要点）だけ。
- **2つのワーカー役割を区別**：①写真報告ワーカー＝digest.md を**読むだけ**（要約しない）。②ダイジェストワーカー＝Slack増分＋未読書類を**マージ要約して digest.md を書く**。両者は同一 VM プロセス・同一 Drive ヘルパ（写真優先→無ければ digest を1件、の相乗りループ）。
- `_ai/` は digest（本節）と **report 版履歴（§5）**の両方を収容する AI 管理フォルダ。**版履歴の書き手は report-app のみ**（§5・§8。人が著者・append-only・監査対象）。

## 8. デプロイ・セキュリティ
- report-app＝Cloud Run＋**IAP（@seibu-s.co.jp 限定 SSO）**。秘密は Cloud Run env。
- **Drive 認証＝mgmt-strat の OAuth**（案件フォルダは mgmt-strat 所有ツリー配下→他者所有写真も継承で読める。DWD不要）。
  - report-app は **`drive` full（RW）**＝版スナップショット・「口」の書込み用。
  - **ワーカーは `drive`(RW)**（2026-06-20・Phase D1〜）：写真/書類の読みに加え、digest 生成物（`_ai/digest.md`・履歴 md＝AI所有・人非接触）の直書きに使う。report-app と同一の mgmt-strat RW トークンを流用（新規同意不要）。**版スナップショットの書き手は引き続き report-app のみ**。
- VM ワーカーは Drive直アクセス（IAP越え不可のため＝統合 Cloud Run IAP がプログラム的 audience 非対応・実測確定）。Claude は **Team/API 認証必須**（D-AIDATA）。
- 顧客写真を Claude に渡すのは D-AIDATA で許可（学習不使用の閉空間＝Team/API）。
- hub-gas Script Properties：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `PHOTO_REPORT_TESTERS`（テスト中はテスター以外のボタン押下を即 return）。

### 8.1 監査ログ（作成者・日時・案件）
専用テーブルは設けず、**既存の記録の組み合わせ**で監査線を満たす（`requirements.md §6`）。

| 観点 | どこに残るか |
|---|---|
| 誰が | 人の版＝版JSON `createdBy`＋Drive `appProperties.createdBy`（IAP メール）／AI 版＝`source=ai`（VM ワーカー） |
| いつ | 各版 `generated_at`／`photo_report_jobs.created_at`・`updated_at`・`notified_at` |
| 何の案件・対象 | `case_id`・`folder_id`（ジョブ／`photo_reports`／版JSON `folderName`・`report.caseId`） |
| 何を作った（内容） | **版JSON の `report` は append-only で不変**＝過去版を書き換えない＝防除用医薬品の使用記録の保管に資する |
| 試行・失敗 | `photo_report_jobs.attempts`（上限 `MAX_ATTEMPTS`）・`error` |

- **既知の小ギャップ**：📸報告書ボタンを押した **Slack ユーザーID は未記録**（`channel`/`thread_ts` は記録）。AI 生成のトリガー主体まで残すなら hub-gas で job に slack user を載せる（将来・低優先）。

## 9. 継ぎ目（D-PORTS・契約候補）
| 継ぎ目 | 種別 |
|---|---|
| Slack ⇄ ロジック（slack-mini-bolt） | 既存 |
| アプリ ⇄ セキュリティ（seibot-proxy・HMAC） | 既存 |
| JUST.DB ⇄ 利用側 | 既存（中央 `contracts/justdb/`） |
| 画像プロキシ＋report JSON（report-app ⇄ ブラウザ/ワーカー） | 新規（稼働後に契約抽出） |
| **digest-gas ⇄ report-app「口」**（要約引き渡し・共用md仕様） | **新規・要契約化** |
| report-app ⇄ Drive `_ai/`（digest.md・report 版履歴） | 新規（版UI実装後に契約抽出） |

## 10. 状態
- ✅ **M1**（WEB単体：実フォルダ→`/report/photo` プリフィル＋印刷）。
- ✅ **M2**（Slack抜きE2E：ジョブ→ワーカー→Drive直読み→Claude Code→report.json→保存）。文脈同梱で精度向上（クマネズミ案件を正しく特定）。
- ✅ **Slackトリガー入口**：hub-gas に「📸報告書」ボタン＋block_actions ハンドラ（pr_start/pr_create/pr_settings）。**prod デプロイ済**・テスター(`U023GCWKLCS`)ガード。VMワーカー prod 運用中（tmux `photo-worker`・MAX_PHOTOS=30）。
- ✅ **写真サブフォルダ化**（§4）＋ **同日エフェメラル** ＋ **done/error 再投入**（Phase3b・hub-gas `a07d64c`・テスターE2E検証済 2026-06-19）。
- ✅ **完了返信**（Phase3c・hub-gas `fd612b5`・prod検証済）：1分毎cron `pr_notifyDoneJobs` が done(未通知)を検知→スレッドへ[📝報告書を開く]→`pr_open` がクリック時に launch token URL を発行（生URLを焼かず期限切れ回避）。`photo_report_jobs.notified_at` で重複防止・再投入時null。
- ✅ **版管理＋注記（report-app・Phase4・実装/静的検証済2026-06-19）**：`/report/photo` を編集面化。
  - **編集**＝見出し/所見/全体要約/並び替え（クライアント島 `PhotoReportEditor`）。
  - **保存＝新版**：Drive `_ai/reports/<folder_id>/v{連番}.json`(append-only・不変・自己記述) を1つ書き、Supabase 現在版を上書き（`POST /api/photo-report/save`）。版ディレクトリは**親案件フォルダ**の `_ai`（digest と共用）。
  - **ロールバック**：版一覧（`GET …/versions`）→旧版の内容で**新版を書く**（`POST …/rollback`・1版＝監査）。
  - **版名・削除**：版名＝Drive `description`（保存時付与＋後編集 `POST …/rename`・本文不変）。削除＝Drive ゴミ箱（`POST …/delete`・復元可・**最新版は不可**・**作成者本人のみ**＝IAPメールと `createdBy` を照合）。
  - **注記（§6）**＝`PhotoAnnotator`：写真上の透明SVG＋Pointer Events（マウス/指/ペン）。赤丸/囲み/矢印/線/手書き/テキスト、色、選択/削除、UNDO/REDO（配列）。座標は0〜1正規化（実表示boxをResizeObserverで測り均一px空間で描画＝歪まない）。注記は report JSON の一部＝版に同梱・ロールバックで一緒に戻る。
  - 書くのは report-app（RWトークン）。ワーカーは readonly 据置。**ブラウザ確認済（2026-06-19）**：保存→v0001/v0002 生成、版一覧、ロールバック。版名/削除は実装直後（要通し）。
- ✅ **設定モーダル＋PDF体裁（2026-06-19）**：`photo_report_settings`（種類/実施日/物件名/担当者/トーン4種）＋⚙️設定モーダル＋「AIで再作成」(`/api/photo-report/{settings,generate}`)。ワーカーが設定をプロンプト反映（見出し≤20・`workItems` 生成）。印刷を齋藤マンション様 PDF 体裁（表紙/番号付きグリッド/概要・内容・免責）に。**残＝Slack「⚙️設定」のURL導線・物件名のJUST.DB取得**。
- ✅ **ダイジェスト“生成” Phase D1（worker側・2026-06-20 実装/E2E済）**：`case_digest_jobs` 投入 → VM ワーカーが未読書類＋Slack増分をマージ要約 → **`_ai/digest.md`・`slack-summary-history.md` を Drive 直書き（Option A）**＋トピック要約を `result_summary` へ。専用テストフォルダで E2E 検証（digest.md 整形・既読マーカー round-trip・履歴追記・2キュー相乗り）。IAP は B案断念で越えない。
- ✅ **ダイジェスト Phase D2（統一正本モデル・GAS切替）＝2026-06-20 本番切替完了**：worker（digest.md 4部構成・2カーソル・重要情報カード=result_summary・absorbed_ts・slack_delta 破棄）＋ migration（absorbed_ts/applied_at）＋ GAS（`supabaseClient.gs`・`td_enqueueCase_`/`topicDigest_applyDone`）。本番で enqueue→VM→digest.md→Slack chat.update を実証（実案件 001926 等）。**旧 `summarizer.gs` 撤去で GAS から ANTHROPIC_API_KEY 参照消滅＝API 課金停止**（残＝Anthropic コンソールでキー失効＝ユーザー）。

## 11. 決定ログ（要点）
- **D-AIDATA**：顧客データは Team/API（閉空間）へなら渡してよい。
- **Drive＝外部SA不可→社内OAuth（mgmt-strat）**：Workspaceが外部に継承を波及させないため。
- **方式Y**：Cloud Run直結IAPがヘッドレス用audienceを露出しない→ワーカーはDrive直読み。IAPはブラウザ保護。
- **デプロイ＝Cloud Run＋IAP**（Vercel Hobbyは非商用不可で却下）。
- **マッピング＝JUST.DB案件一覧**（新規基盤不要）。
- **報告書の単位＝写真サブフォルダ**（訪問ごとに分離。同日再クリックはエフェメラル）。
- **現在版＝Supabase（1件）／版履歴＝Drive `_ai/reports/` append-only**。書くのは report-app（ワーカーは readonly 据置）。
- **PDF はシステム非責務**（人が任意で印刷）。複数報告書の管理も人の運用。
- **トピック報告書レジストリ/モーダルは作らない**（到達導線は完了返信1本で足りる）。
- **赤丸＝写真不変・JSON重ね描き（SVG/正規化座標）**。版管理に同梱。
- **ダイジェスト＝要約“計算”はVMワーカー（GASのAPI直叩き廃止）**／**生成物の書き戻しはワーカーが Drive 直書き（Option A・D-DIGEST追補）**＝統合Cloud Run IAPがプログラム的audience非対応のため「口」経由を断念。GD書類は既読マーカーで増分読み＋索引。版スナップショットの書き手はreport-appのみ（不変）。
