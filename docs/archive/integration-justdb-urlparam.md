# JUST.DB連携仕様（v0.5）

## 1. 連携方針

JUST.DB側はレコードにアプリURLを保持し、画面起動時にキー情報をURLパラメータとして渡す。
本アプリは受信したキーを外部キーとして保持するが、JUST.DBへの書き戻しは行わない。

## 2. URL形式

```text
/report/new?caseId={案件ID}&investigationId={調査予定ID}&constructionId={施工予定ID}&driveFolderUrl={GoogleDriveフォルダURL}
```

トークン検証は将来拡張とし、現時点ではトークンなしで運用する。

## 3. パラメータ定義

- `caseId`（必須）: 案件ID
- `investigationId`（任意）: 調査予定ID
- `constructionId`（任意）: 施工予定ID
- `driveFolderUrl`（必須・正規）: 保存先GoogleドライブフォルダURL
- `driveFolderId`（任意・代替）: 保存先GoogleドライブフォルダID
- `token`（任意）: 将来拡張の署名トークン

## 4. アプリ側処理

1. URLパラメータを受信する
2. 必須パラメータを検証する
3. トークンがある場合のみ署名検証する
4. 問題なければフォーム初期値として表示する
5. キー項目は原則編集不可にする
6. 報告書はアプリ側ストレージに保存する
7. 指定されたGoogleドライブフォルダへ成果物を保存する

## 5. JUST.DB側の責務

- 対象レコードにアプリ起動リンクを保持する
- 起動時にレコードキーとGoogleドライブURLをクエリに付与する
- 報告書データの受信・更新は行わない

## 6. 決定事項

- `driveFolderUrl` を正規入力とする
- `driveFolderId` は代替入力として受け付ける
- 当面はトークンなし運用とする
