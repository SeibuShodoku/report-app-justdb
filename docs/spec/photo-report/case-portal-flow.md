# 案件ポータル動線（北極星の入口設計）

> 決定 2026-06-27。Slack を「入口1ボタン＋完了通知」だけにし、種類選択・写真フォルダ案内・報告書作成の前ふりを **Web** へ寄せる。
> 正本アーキ＝[`../../architecture/slack-photo-report-architecture.md`](../../architecture/slack-photo-report-architecture.md)。

## なぜ
「⚙️設定」を押すと編集画面に入る＝**Webに入れば写真投入も設定も全部できる**。だから「先に Drive に写真を入れておく」前提は不要。Slack 側の前ふり（種類選択・フォルダ案内）も剥がせる。

## 目標の動線
1. Slack のトピックに **1ボタン「📋 報告・見積」** → クリックで**ケース用URL**（launch token）を発行。
2. URL を開くと **案件メニュー**＝`調査写真報告書 / 見積書 / 施工写真報告書 / 防除作業報告書` の入口。
3. 写真系を選ぶと、その日の一意な GD フォルダに対し **ページの状態で出し分け**：

| 状態 | 画面 |
|---|---|
| **A. 写真ゼロ** | 「📷 写真をアップロード」＋設定（種類はメニュー選択で内定）。AI作成は無効。 |
| **B. 写真あり** | 編集画面（グリッド＋見出し/並べ替え/赤丸＋設定＋「AIで作成」）。「＋写真を追加」常設。 |
| **C. 生成中** | 「作成中です…」固定（同URL）。完了で Slack 通知。 |
| **D. 完成** | 編集／PDF出力／プレビュー。 |

4. Slack に残すのは **①案件メニューを開く1ボタン ②完了通知** のみ（入口と通知の専任）。
   - Slackボタンが渡す最小情報＝`caseId ＋ 案件ルートの Drive フォルダ`（topic が保持）→ ケース用トークンURL。
   - **その日の写真フォルダ作成（find-or-create）は Web 側へ移動**（Slack の `pr_start` 廃止方向）。

## フェーズ
- **フェーズ1（完了・2026-06-27, rev `report-app-justdb-00036-8n7`）＝Web 写真アップロード＋状態A/B**
  - `POST /api/photo-report/upload?folderId&token`：起動トークン認可（folderId 一致・人の操作のみ）。**1枚ずつ送る**（複数まとめは Cloud Run 32MB 超で HTML(413)→JSON解析失敗するため）。`image/*`・1枚25MB・iOS の type 空は拡張子で救済。
  - `drive-write.uploadImageFile`（バイナリ multipart で写真フォルダへ直書き）。
  - 編集面：写真ゼロ＝アップローダ主役／写真あり＝「＋写真を追加」。**結果は items に追記してリロードしない**（編集中を失わない）。
  - AIボタンは `hasStoredReport` で「**AIで作成**（初回）／**AIで再作成**（既存）」を出し分け。
  - ※Slack は未変更（非破壊）。既存フロー（📸報告書→開く／⚙️設定URL）からこのページに着ける。
- **フェーズ2（未）＝案件メニュー＋ Slack 1本化**
  - 案件メニュー（4種の入口）ページ。Slack ボタンを **「📋 報告・見積」** に集約＋種類選択を剥がす。その日のフォルダ find-or-create を Web 側で。
  - **GAS（hub-gas）の小変更が入る＝デプロイは本人**（AI は GAS を deploy しない）。
- **フェーズ3（未）＝防除・見積をメニューに接続**。

## 関連実装（フェーズ1で入ったもの）
- 写真アップロード：`src/app/api/photo-report/upload/route.ts`・`src/lib/drive-write.ts`・`src/components/photo-report-editor.tsx`。
- AIボタン文言：`src/lib/photo-report-source.ts`（`hasStoredReport`）→ `src/app/report/photo/page.tsx`。
- 移行方針：**既存 Slack フローと並行**で出す（現場が困らない）。
