# 写真報告書 — PDF 実機 E2E 検証チェックリスト

> 目的：**「実装済みだが人が一度も通していない」PDF 出力を実機で確定**する（特にサーバーPDF＝方式A）。
> 仕様＝[`../../architecture/slack-photo-report-architecture.md`](../../architecture/slack-photo-report-architecture.md) §6.5。実装手順＝[`slack-photo-report-impl-plan.md`](slack-photo-report-impl-plan.md) フェーズ6。
> 本番：`report-app-justdb-00027-f8l`／`https://report-app-justdb-wuyjdntfda-an.a.run.app`（IAP・@seibu-s.co.jp SSO）。
> 状態（コード側の裏取り済 2026-06-25）：UI に2系統のPDFボタンが配線済（`window.print` ＋「サーバーPDF（保存版）」）。Dockerfile に `chromium`＋`fonts-noto-cjk`＋`dumb-init`、`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` 設定済＝**本番ではサーバーPDFが動く想定**。残るは実機での目視確認のみ。

## 0. 重要な前提（押す前に）

- **サーバーPDF の対象＝保存済みの現在版**。`window.print` は編集中DOM（未保存も写る）。→ **必ず先に「保存（新しい版）」してからサーバーPDFを押す**。
- サーバーPDF は同コンテナの localhost 印刷ビューを Chromium で開く＝**IAP を跨がない／端末非依存の決定的出力**。`window.print` は端末ブラウザ依存（iPhone Safari 等で差が出うる）。

## 1. 検証する報告書を開く（どちらか）

**A：実フロー（推奨＝実ユーザーと同じ経路）**
1. Slack 案件スレッドで「📸報告書」→ 案内された写真サブフォルダ（`写真_YYYYMMDD`）に写真を数枚置く。
2. 「📝報告書作成」→ 完了通知の「📝報告書を開く」→ URL を IAP/SSO で開く。

**B：fast-path（反復検証用・トークン直生成）**
```
REPORT_LINK_SECRET=<本番と同値の秘密> node scripts/generate-launch-token.mjs <caseId> "" "" <FOLDER_ID> 3600
```
- 出力**1行目のトークン**を使い、ブラウザで開く：
  `https://report-app-justdb-wuyjdntfda-an.a.run.app/report/photo?folderId=<FOLDER_ID>&token=<TOKEN>`
- `<FOLDER_ID>`＝写真サブフォルダの Drive フォルダID。`token.driveFolderId == folderId` でないと「アクセスエラー」になる。
- 注意：スクリプトが出す**2行目 `/report/new?...` は旧・汎用報告書用なので使わない**（写真はパス `/report/photo`・キーは `folderId`）。`REPORT_LINK_SECRET` は Cloud Run env と同値（手元だけ・共有しない）。

## 2. window.print（クライアント印刷）

「PDFで保存（印刷）」→ ブラウザの印刷プレビューで：
- [ ] 表紙＝種類タイトル（施工/調査報告書）・実施日・現場・会社フッター（城東支店）・**表紙写真**（⚙️設定で `coverFileId` を変えると反映）。
- [ ] 写真ページ＝**8枚/ページ（縦4×横2）**・各写真に「N．見出し」。
- [ ] 最終ページ＝概要（`headerSummary`）／内容（`workItems` 番号付き）／**免責事項**。
- [ ] A4・操作ボタン非表示・日本語が崩れない・改ページが綺麗（白紙ページが出ない）。

## 3. サーバーPDF（方式A）★本命

「保存（新しい版）」→「サーバーPDF（保存版）」→ 新規タブで PDF ダウンロード。確認：
- [ ] **HTTP 200・`application/pdf`** でDLされる（タブに `{"error": …}` JSON が出ない）。
- [ ] **日本語が豆腐（□）にならない**（＝`fonts-noto-cjk` 効いている）。
- [ ] 表紙／グリッド／最終ページが **window.print と一致**（割付・番号・免責）。
- [ ] **注記（赤丸・矢印・手書き）が写真にピタリ重なる** ← ★最重要・最リスク。印刷媒体切替後に注記SVGの `ResizeObserver` が再測する箇所（route は `goto`→`emulateMediaType("print")`→画像待ち→700ms→`page.pdf`）。ズレ・消失が無いか必ず確認。
- [ ] **改ページ**：表紙1枚 → 写真ページ群 → 最終ページ。余計な白紙が無い。
- [ ] **8枚未満の最終写真ページ**（端数）でレイアウトが崩れない。
- [ ] 写真が**全部出る**（途中で欠け・真っ白が無い＝画像ロード待ちが足りているか）。

## 4. 失敗 → 原因 → 対処

| 症状 | 原因の当たり | 対処 |
|---|---|---|
| 503「PUPPETEER_EXECUTABLE_PATH 未設定」 | ローカル＝正常（Chromium無）。**本番で出たら**Dockerfile/env が rev に反映されていない | 本番なら再デプロイ・`PUPPETEER_EXECUTABLE_PATH` 確認 |
| 日本語が □（豆腐） | フォント未導入 | 本番は `fonts-noto-cjk` 済のはず。再発なら Dockerfile 確認 |
| 写真が途中から真っ白／欠け | 画像ロード待ち不足／Drive 画像が重い | route の待機（`networkidle0`＋画像 load＋700ms／timeout 45s）を延ばす |
| 注記（赤丸）がズレる・消える | print 媒体切替後の `ResizeObserver` 再測タイミング | 700ms 待ちを延長 or `emulateMediaType` を `goto` 前に／再測完了をポーリング |
| 余計な白紙ページ | `break-before/after` の競合 | 表紙は `break-after` 無し設計（§globals.css）。崩れたら該当ルール調整 |
| 「アクセスエラー（トークン…）」 | `folderId` と `token.driveFolderId` 不一致／期限切れ／secret 不一致 | fast-path の引数・ttl・`REPORT_LINK_SECRET` を確認 |
| サーバーPDFが古い内容 | 未保存で押した（対象＝保存済み現在版） | 先に「保存（新しい版）」してから押す |

## 5. 結果報告テンプレ（埋めて共有→不具合は即修正）

```
報告書：<caseId / folderId>　端末：<PC Chrome / iPhone Safari…>
2. window.print   ：✓ / ✗（✗の項目：               ）
3. サーバーPDF    ：✓ / ✗（✗の項目：               ）
3. 注記の重なり   ：✓ / ✗（ズレ量・該当写真：       ）
気づき／スクショ  ：
```

## 結果（2026-06-25・実機 E2E）

- **サーバーPDF**：✓ 動作・DL可・**日本語フォント OK**（豆腐なし）・表紙／8枚グリッド／最終ページ。
- **注記（赤丸）**：✓ 写真に整合（ズレなし）。
- **修正済の不具合**：写真グリッドの**キャプションと写真の重なり・文字切れ** → caption を 9mm 固定行に・画像 `max-height:50mm`（commit `f1f8bd7`／rev `00028` 以降）。
- **残**：縦長／横長が混在する実案件での崩れ確認。テストフォルダ（トークン直開き）は Slack を通らないため、Slack 完了通知の確認は実案件フローで。
