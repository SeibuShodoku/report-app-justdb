# 見積書（リング2）課題・未配線一覧

> 仕様本体＝[`ring2-estimate.md`](ring2-estimate.md)。計算式の正本は別リポ `docs/justdb-dataflows.md`「見積系（tojo一族）」。
> 横断の未確定は [`../open-issues.md`](../open-issues.md)（本書はその §7 から見積固有を分離したもの）。
> 最終更新：2026-06-25（試作 prod 稼働＝**レビュー段階・仮完成**で一旦停止。次は写真報告書へ）。

## 0. 現状の切り分け — 「計算」は確定、残るは「配線」

- **できている（確定）**：原価積算の**計算エンジン**（`src/lib/estimate-calc.ts`・実CSV14行で検算一致）／計算式設定の**版管理**（`/admin/estimate-settings`）／販売価格表ミラー `chemical_products`／エディタ `/estimate`（検索select・シロアリ施工プラン・粗利率%表記・計算ステータス・sticky合計・移動距離=基本情報で全明細適用）。
- **残っている（＝本書）**：見積を**保存・起動・陳列・PDF 化・JUST.DB 連携**する「配線（plumbing）」と、入力値の**マスタ素性／マスタ化**。
- ひとことで：**`/estimate` は今「電卓」**（リロードで消えるライブ計算）。**「書類」にするための配線が未**。

---

## A. 配線（仮完成の最大ギャップ）

### A1. 保存・永続化が無い 〔最優先〕
`/estimate` は `useMemo` のライブ計算のみで、**作った見積を保存／再編集する経路が無い**（リロードで消える）。専用スキーマ（`estimate_drafts` / `estimates`）も保存 API も未定義。
- 方針：写真／防除の**版管理基盤を流用**＝`src/lib/report-versions.ts`（report-type 非依存の汎用版層）＋ Drive `_ai/reports/<key>/` append-only ＋ Supabase 現在版。見積の保管キー（folder_id か 見積管理番号 `E-{支店}-{日付}-{連番}-{版}`）を決める。
- リング2 ④に相当。

### A2. 起動経路・案件文脈が未配線
写真／防除は **Slack ボタン → hub-gas → 署名付き起動トークン → `?folderId&token`** で開き、案件↔フォルダ↔顧客が解決される。見積は**直 URL `/estimate` のみ**で、顧客名・施工先・案件IDは**手入力**。
- 未：Slack 起動（`pr_*_estimate` 相当）／`launch-token` 経路／`/api/case` プリフィル（construction_schedules から顧客・施工先）。
- 注：案件文脈のライブ取得を JUST.DB に向けると API 予算に当たる（[`../open-issues.md` §0](../open-issues.md)）。起動トークン経由（予算ゼロ）を既定にする＝写真／防除と一貫。

### A3. 案件マニフェストに出ない（陳列・顧客提示に乗らない）
確定成果物索引 `case_deliverables`（社内／顧客 共通レンダラの単一ソース）に**見積が登録されない**。よって案件ポータルの時系列陳列・顧客提示サーフェス（リング1c）に**見積が現れない**。
- 未：確定（confirm）アクションの `report_type=estimate` 拡張（`src/app/api/report/confirm/route.ts` は report-type 共通の想定）。
- 見積は写真を持たない → 確定＝snapshot 登録＋マニフェスト登録だけ（写真凍結不要・防除と同型）。

### A4. A4固定 見積PDF が未実装 〔リング2 ③〕
写真／防除と同じ印刷基盤（`window.print` ＋ サーバーPDF方式A＝同コンテナ headless Chromium）に**未接続**。
- 免責は `src/lib/report-template.ts` の `DISCLAIMER` 同系（CSV の免責事項文言と一致させる）。表紙→明細→（薬剤明細）の A4 体裁を固定。

---

## B. マスタ・データ素性

### B1. 入力値の根拠（データテーブル定義.xlsx）
単価・各率・薬剤係数・原価係数・坪単価の**マスタ値の出どころ**は JUST.DB「データテーブル定義.xlsx」側の確認待ち（**式中の意味は判明済**・engine は実CSV14行で一致）。

### B2. 旧／NEW tojo の併存
移行過渡期で旧 `tojo見積作成` と `(NEW)` が**両稼働**。実際にどちらのパネルが発火するか（採取元の版差）要確認。採取時 1部品（`新環境_ACTNo23_石橋4_2`）が 79/80 で未採取。

### B3. シロアリ施工プラン／坪単価表のハードコード
`TERMITE_PLANS`(12) / `TERMITE_CHEMS`(4) はエディタ（`estimate-editor.tsx`）に**ハードコード**。版管理／マスタ化は将来（価格改定でコード修正が要る）。

### B4. 販売価格表 `sort_order` の運用
表示順は migration `…170000` 適用＋**再 import で有効**（それまで品目名順）。価格改定時は **再 export → 再 import**（手運用）。

### B5. 薬剤2テーブルが未統合
見積は `chemical_products`（売価／原価ミラー）、報告書カスケードは `chemicals`（粒度別・本番稼働）。**今は別テーブル**＝JUST.DB 実連携時に統合予定。

---

## C. 連携（API予算 gate）

### C1. JUST.DB への見積書き戻し
計算済み見積の JUST.DB（会計）反映は**別軸・後・API予算 gate 内**（[`../open-issues.md` §0](../open-issues.md)）。当面 read-only 志向（報告書サイトと同じ）。

---

## D. 軽微UX（見やすさの続き・任意）

- D1. 値更新時の軽いハイライト（動き）／見積金額・合計の階層強調／セクションの淡色分け。
- D2. 粗利率の健全性カラー（赤字=赤／<25%=橙／緑）の閾値は暫定＝運用で調整余地。
- D3. backdated 見積日の設定版 再解決（現状 props は**今日時点の版**を渡す。過去日の見積は `resolveSettingsForDate` で再解決すべき）。

---

## E. 運用作業（ユーザー・デプロイ時の必須手順）

- migration 3件を Supabase SQL Editor に適用：`estimate_settings`（`…150000`）／`chemical_products`（`…160000`）／`sort_order`（`…170000`）。
- `scripts/import-price-book.mjs` で販売価格表を取り込み（価格改定時は再 export → 再実行）。
- 手順＝[`../../runbook/deploy.md`](../../runbook/deploy.md) §3。

---

## 優先順（仮）

再開時はまず **A1（保存）→ A2（起動・案件文脈）→ A3（マニフェスト）→ A4（A4 PDF）** の配線が「電卓→書類」の本線。B/C は連携・マスタ確定とともに。D は仕上げ。
