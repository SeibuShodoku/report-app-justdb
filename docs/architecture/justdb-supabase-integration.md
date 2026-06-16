# JUST.DB × Supabase 連携設計

## 役割分担

- **JUST.DB** = 正本（システム・オブ・レコード）。事務データに特化。
- **Supabase** = 取得を軽くするための層。薬剤資材のミラー＋ケースデータ。
- **WEBアプリ** = 作成・AI・出力。読み取りはサーバー側のAPIルートからのみ行う
  （サービスロールキーはクライアントに渡さない）。

## 起動とパラメータ（JUST.DBから）

JUST.DB側はレコードにアプリ起動リンクを保持し、起動時にキーをURLパラメータで渡す。

```
/report/new?caseId={案件ID}&investigationId={調査予定ID}&constructionId={施工予定ID}&driveFolderUrl={GoogleDriveフォルダURL}
```

- `caseId`（必須）/ `investigationId`（任意）/ `constructionId`（任意・=施工予定ID）
- `driveFolderUrl`（正規）/ `driveFolderId`（代替）/ `token`（任意・将来の署名検証）
- キー項目は原則編集不可。トークンは指定時のみ署名検証（当面トークンなし運用）。

（旧 JUST.DB連携仕様〔URLパラメータ方式〕を統合。旧版は `archive/integration-justdb-urlparam.md`。）

## アンカーと結合チェーン

報告書 ↔ 施工 は **施工予定ID** で 1:1（施工日程テーブル）。

```
施工予定ID ──(FK)── 案件ID ── 受注ID / 見積書 / その他
```

起動時は施工予定ID（既存 launch context の `constructionId`）を起点に、
ケースデータ（顧客名・施工先・施工日時・報告日）を引く。

## カスケード（施工内容の入力）

```
対象害虫 ──▶ 使用薬剤（適用害虫で絞り込み）──▶ 処理方法（薬剤ごと）
```

薬剤資材ミラー `chemicals` の各行が `applicable_pests`（適用害虫）と
`methods`（処理方法）を持つ。これだけで害虫→薬剤→処理方法が絞り込める。
（実テーブルにこの関連が無ければ、Supabase側にこのミラー構造で持たせる。）

## データ取得API（サーバー）

| ルート | 用途 |
|---|---|
| `GET /api/master/pests` | 害虫マスタ（カスケード1段目） |
| `GET /api/master/chemicals?pest=ネズミ` | 適用薬剤＋各薬剤の処理方法 |
| `GET /api/case?constructionId=CONST001` | 施工予定IDでケースデータ |

すべて `src/lib/supabase-rest.ts` 経由で PostgREST に問い合わせる（SDK非依存）。

## JUST.DB → Supabase 同期（現状: スタブ）

> 現時点では JUST.DB API は未接続。`docs/supabase/schema-and-seed.sql` の
> シードが「同期済みの状態」を代替する。プレゼンはこれで成立する。

**本実装時の手順（将来）:**
1. JUST.DB API で薬剤資材テーブルを取得（薬剤ID・名称・単位・適用害虫・処理方法）。
2. `chemicals` に upsert（`justdb_id` を同期キー、`synced_at` を更新）。
3. 頻度は日次 or 手動「同期」ボタンで十分（薬剤資材は滅多に変わらない）。
4. ケースデータ（施工日程）は動的なので、本番では「施工予定IDでJUST.DBをライブ取得」か
   「選択ミラー」かを別途決定する。

## セットアップ

1. Supabase プロジェクトを作成。
2. SQL Editor で `docs/supabase/schema-and-seed.sql` を実行（テーブル＋シード）。
3. `.env.local` に設定（**`.env.local` は Git 管理外**）:
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=（Project Settings → API → service_role）
   ```
4. `npm run dev` → http://localhost:3000/mock

## 確認

- 画面上部「マスタ接続OK（害虫 2 種）」と出れば疎通OK。
- 「施工予定ID = CONST001」で「JUST.DBから取得」→ 心行寺／江東区南砂が入る。
- 施工内容の対象害虫で「ネズミ」→ 使用薬剤が絞られ、薬剤を選ぶと処理方法が絞られる。
