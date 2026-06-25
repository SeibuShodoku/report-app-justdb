# Ring 1a 仕様 — 防除作業報告書（紺谷V）の実体化

最終更新：2026-06-20
状態：**実装・本番デプロイ済（2026-06-21）**。Cloud Run rev `report-app-justdb-00008`／hub-gas は **clasp push＋`clasp deploy -i <prod> @1085`**（**push だけでは prod `/exec` に反映されない＝要注意**・[[hub-gas-webapp-deploy]]）／topic-digest は cron(HEAD)反映。要・実機E2E（テスター）。北極星＝[`../../vision/case-portal.md`](../../vision/case-portal.md)（D-PORTAL）。現況アーキ＝[`../../architecture/slack-photo-report-architecture.md`](../../architecture/slack-photo-report-architecture.md)。

## 0. スコープ
リング1のうち **1a＝防除作業報告書(A・紺谷V)を「モックのみ」から「保存・版管理できる実フロー」へ**。

- **やる**：**Slackボタン起動（写真と同じ・hub-gas）**・防除報告書の作成画面・**使用薬剤必須**・保存/版管理/ロールバック・紺谷V印刷体裁。**Bの版管理基盤を流用**。**確定→マニフェスト登録**（共有基盤・写真B/1c と共用・D6）。
- **やらない（1a外）**：融合版(A＋B合成)＝**凍結**。顧客提示サーフェス＝1c（別）。AIによる文章生成＝当面テンプレ（将来）。JUST.DB書き戻し＝将来の Schedule／終了報告に属し範囲外（報告書サイトは read-only。2026-06-21 切り分け）。薬剤カスケードは**現行のまま変更なし**。

## 1. 現状（調査結果）
- **防除報告書は 100% モック**：`src/app/mock/page.tsx` の「紺谷V」タブは React state のみ。**永続化・保存API・専用スキーマは存在しない**。
- 使える既存資産（流用）：
  - **カスケード**：`/api/master/pests`（`{pests:string[]}`）＋`/api/master/chemicals?pest=`（`{chemicals:{name,unit,methods[]}[]}`）。`pests`/`chemicals` テーブル（`report-app-schema.sql`）。
  - **ケース取得**：`/api/case?constructionId=`→`construction_schedules`（construction_id/case_id/order_id/customer_name/site/scheduled_at/report_date）。
  - **定型**：`src/lib/report-template.ts` の `BRANCH`（城東支店）／`DISCLAIMER`。
  - 紺谷Vの画面構造：ヘッダ＋顧客/日付/担当＋施工内容テーブル（害虫→薬剤→処理方法＋量＋備考）＋駆除作業報告（自由文）＋生息状況テーブル＋効果判定（`mock/page.tsx`）。

## 2. 流用するB版管理基盤（再利用インターフェース）
- **Drive 版層（汎用）**：`src/lib/report-versions.ts` … `parseVersionNumber`/`formatVersionFileName`/`nextVersionNumber`/`buildVersionFile`。版ファイル＝自己記述（`version/generatedAt/source/createdBy/note/folderName/report`）。`report` の中身型に依存しない＝**ほぼそのまま流用可**。
- **保存/一覧/版操作**：`src/lib/photo-report-store.ts` … `saveReportVersion`/`listReportVersions`/`renameReportVersion`/`deleteReportVersion`/`rollbackToVersion`/`readVersionReport`/`upsertCurrent`。
- **保管レイアウト**：Drive `_ai/reports/<folder_id>/v0001.json…`（append-only・不変）＋ Supabase 現在版（`photo_reports` folder_id キー）。
- **API パターン**：`/api/photo-report/{save,versions,rollback,rename,delete}`（起動トークン／作成者本人のみ削除／最新版削除不可／版名＝Drive description）。

## 3. 設計決定（推し）と要確認

### D1. 流用方式 ＝「汎用版層 ＋ 並行ストア」（本流を壊さない）
- `report-versions.ts` を **report-type 非依存の汎用層**として確定（版ファイルに `reportType` を追加）。
- 防除用は **`src/lib/prevention-report-store.ts`（新規）** が同じ Drive 版ヘルパを呼ぶ＋**並行 Supabase テーブル `prevention_reports`**。
- **理由**：稼働中の `photo-report-store.ts`/写真フローを大改修せず、版機構だけ共有＝reuse の実利を取りつつ回帰リスク最小。将来必要なら `report-store.ts` へ完全統合。

### D2. 起動と保管キー ＝ 写真報告書と同じ「Slackボタン → folder_id キー」（2026-06-20 確定）
- **起動＝Slackボタン（写真と同一機構）**。案件スレッドの「報告書」ボタン → hub-gas が **案件↔フォルダ↔スレッドを解決**（写真で実装済み・JUST.DB案件一覧の GD URL 等）→ **署名付き起動トークンURL**で `/report/prevention?folderId=…&token=…` を開く。**report-app は JUST.DB を呼ばない**（folderId はトークンURLで受領＝予算ゼロ・写真と一貫）。
- **キー＝folder_id（写真と同一機構を流用）**。防除は案件配下に**自分の `防除_YYYYMMDD` サブフォルダ**（写真の `写真_` と並列・hub-gas が find-or-create）を持ち、版は `_ai/reports/<防除folder_id>/prevention/`（親案件フォルダの `_ai`・reportType 名前空間）。Supabase 現在版は **folder_id 主キー**（写真の `photo_reports` と別テーブル `prevention_reports`）。**実装＝別フォルダなので衝突せず**（deliverable_id も `reportType:folderId:v…` で写真と非衝突）。
- **AIジョブ不要**：防除(紺谷V)は人が入力（カスケード＋手入力）。写真のような worker 生成・完了返信ループは無く、**ボタン→プリフィル空フォーム→保存(版)** だけ＝写真より単純。
- 確定：ボタンUX＝**「📋 報告書」1本→本人にエフェメラルで[📸写真][🛡️防除]選択**（実装済 `pr_menu`）。防除フォルダ名＝`防除_YYYYMMDD`。

### D3. スキーマ `preventionReportDraftSchema`（新規 `src/schemas/prevention-report.ts`）
モック構造に対応：ヘッダ（reportDate/customer/site/manager/supervisor/worker）／施工日時／**施工内容 `workItems[]`**（pest・**chemical(使用薬剤)**・method・amount・note）／駆除作業報告 `reportText`／生息状況 `statusItems[]`／効果判定 `effectRating`。
- **使用薬剤必須**＝`superRefine`：`workItems` の少なくとも1行に非空 `chemical`（無ければ保存不可・明示エラー）。
- **キー＝folder_id**（D2）。`caseId`/`constructionId` は `/api/case` プリフィルの文脈（任意フィールド）。

### D4. カスケード・ケース取得＝現行流用（変更なし）
`/api/master/{pests,chemicals}`・`/api/case` をそのまま。鮮度確認のみ（必要なら別途）。

### D5. 印刷体裁＝紺谷V print CSS
モックのHTML構造を `/report/prevention` の print CSS 化（`BRANCH`/`DISCLAIMER` 流用）。PDF はブラウザ印刷（システム非責務・既存方針踏襲）。

### D6. 確定・凍結・マニフェスト（フォルダ構造＝vision §4.5）
詳細＝[`../../vision/case-portal.md` §4.5](../../vision/case-portal.md)。1a 関連の要点：
- **フォルダ2ゾーン**：可変＝**写真投入サブ（写真_YYYYMMDD・スタッフに直接書込共有＝ユーザーの保存場所）**／不変＝ `_ai/`（mgmt限定・兄弟配置）。`_ai/` を施錠するには**管理コンテナをスタッフ非共有**（写真サブのみ個別共有）。既存案件フォルダが広く共有済みなら `_ai/` は**別 mgmt 専用ツリー**へ（実装時に現状ACLを確認）。詳細＝vision §4.5。
- **防除は写真を持たない** → 確定＝report.json スナップショット＋マニフェスト登録だけ（**写真凍結は不要**）。写真凍結（`_ai/assets/<deliverableId>/` へコピー）は**写真報告書(B)の confirm 実装時**に行う。
- **マニフェスト＝Supabase `case_deliverables`**（案件キー・確定版を指す索引・Drive から再生成可）。**社内/顧客 共通レンダラの単一ソース**（顧客面=1c）。
- **確定（公開）アクション**＝版履歴(folder単位)→確定版をマニフェストへ登録＝**顧客可視の起点**。1a の防除確定がこの共有基盤の最初の利用者（写真B・1c も共用）。
- `case_deliverables`（最小スキーマ案）：`case_id` / `deliverable_id`(PK) / `report_type`(`photo`|`prevention`) / `stage`(`survey`|`construction`…) / `folder_id` / `version`(確定版) / `assets_path`(写真凍結先・防除null) / `title` / `customer_visible`(bool) / `confirmed_by` / `confirmed_at`。

## 4. ビルド項目（ファイル単位）
**新規**
1. `src/schemas/prevention-report.ts` … `preventionReportDraftSchema`（＋使用薬剤必須 refine）。
2. `docs/supabase/migrations/<ts>_create_prevention_reports.sql` … `prevention_reports`（construction_id PK・report_json・source・generated_at）。
3. `src/lib/prevention-report-store.ts` … 版保存/一覧/ロールバック/版名/削除（`report-versions.ts` 流用・Drive 名前空間 `prevention/<constructionId>/`・Supabase 現在版）。
4. `src/app/api/prevention-report/{save,versions,rollback,rename,delete}/route.ts` … 写真側 API を report-type=prevention で複製。
5. `src/app/report/prevention/page.tsx` … 作成・編集画面（カスケード＋ケース prefill＋版UI＋紺谷V print）。起動＝`?constructionId=…&driveFolderId=…&token=…`。

**変更**
6. `src/lib/report-versions.ts` … 版ファイルに `reportType:"photo"|"prevention"` を追加（写真側は既定 "photo" 後方互換）。
7. （必要なら）`src/schemas/index.ts` に型 export 追加。

**共有基盤（マニフェスト・確定／写真B・1c も使う）**
8. `docs/supabase/migrations/<ts>_create_case_deliverables.sql` … `case_deliverables`（D6スキーマ）。
9. `src/lib/case-deliverables.ts` … マニフェスト登録/一覧/読取＋**確定アクション**（防除＝snapshot登録／写真＝写真凍結 `_ai/assets/` も）。
10. `src/app/api/report/confirm/route.ts` … 確定（公開）エンドポイント（report-type 共通）。

**別リポ（justdb-hub-gas）**
11. ✅ 案件スレッドの「📋報告書」(`pr_menu`)→エフェメラル[写真][防除]選択。防除は **AIジョブ無し**で `防除_YYYYMMDD` find-or-create→`/report/prevention?folderId&token` を本人発行（`pr_start_prevention`/`pr_open_prevention`）。写真の `pr_start`/`pr_open` パターンを複製・複製ボタンも同期。**実装済**（commit 45cb74f）。

**任意・後**
12. `/mock` 紺谷Vタブから本フローへの導線（保存ボタン）。

## 5. テスト
- スキーマ：使用薬剤空→保存不可／1行でも薬剤あり→OK。
- 版層：save→v0001、再save→v0002、rollback→新版、最新版削除不可、本人以外削除不可（写真側のテスト流用）。
- カスケード：害虫選択→薬剤候補→処理方法候補が現行どおり。
- 印刷：紺谷V体裁が崩れない（print CSS）。

## 6. 1a 内の順序
`D3スキーマ → 2 migration → 3 store（版層流用）→ 4 API → 5 画面 → 印刷CSS → テスト`。
回帰防止：6（report-versions に reportType 追加）は写真側既定 "photo" で**挙動不変**を先に確認。

## 7. 依存・リスク
- Drive RW トークン（mgmt-strat）は既存（写真版保存と同じ）。
- JUST.DB は `/api/case`（construction_schedules ＝ Supabase ミラー）経由＝**ライブ JUST.DB 非依存**（予算に当たらない）。driveFolderId 解決を JUST.DB 案件一覧ライブにすると予算に当たるため、当面は**起動パラメータ受け取り**を既定（D2 要確認）。
- `prevention_reports` は写真の `photo_reports` と別テーブル（衝突なし）。
