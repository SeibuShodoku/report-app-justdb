# PHOTO_REPORT_API_CONTRACT.md — report-app HTTP 面 ⇄ ブラウザ / VM ワーカー 契約

最終更新：2026-06-19
対象：report-app（Cloud Run・Next.js）の写真報告 HTTP 面と、それを叩く **ブラウザ（編集面）** および
**VM ワーカー（AI 生成）** の受け渡し仕様の**正本**。

> **D-PORTS 原則**：本契約は**現在動いている実装から抽出**した（contract-by-extraction）。
> 正本実装＝`report-app-justdb`（`src/app/api/...`・`src/lib/...`）。理想でなく実物を記述する。
> 横断契約（digest-gas ⇄ 口）は別途 [`contracts/case-digest/`](../../../contracts/case-digest/)。本書は report-app 内部の HTTP 面。

---

## 0. 全体像

```
[ブラウザ(編集面 /report/photo・@seibu-s.co.jp SSO)]   [VM ワーカー(AI 生成)]
        │ 起動トークン(token)                              │ x-proxy-secret ヘッダ
        ▼                                                  ▼
   ┌──────────────── report-app (Cloud Run + IAP) ────────────────┐
   │  画像プロキシ: GET /api/folder, /api/photo                     │
   │  報告書取得  : GET /api/photo-report                           │
   │  版管理(書込): POST /api/photo-report/{save,rollback,rename,delete}, GET …/versions │
   └──────────────────────────────────────────────────────────────┘
        │ Drive RW(report-app) / readonly(worker)        │ Supabase(現在版)
        ▼                                                ▼
   [Google Drive 案件フォルダ / _ai/reports/<folder_id>/v*.json]   [photo_reports / photo_report_jobs]
```

- **責務・鍵の持ち主**：Drive 資格情報は report-app（RW）と VM（readonly）が各々保持。ブラウザは持たない。
  Supabase service_role は report-app と VM が保持。ブラウザは持たない。
- **境界の不変条件**：
  - ブラウザは Drive/Supabase を直接叩かない（必ず report-app 経由）。
  - **書込み系（save/rollback/rename/delete）はブラウザ（起動トークン）のみ**。VM（x-proxy-secret）は**読取系のみ**。
  - **版の本文は report-app だけが書く**（ワーカーは readonly 据置＝VM→IAP 越え不要）。

---

## 1. 認証（全エンドポイント共通・`src/lib/security/proxy-auth.ts`）

入口で 2 種を出し分ける：

| 相手 | 提示 | 検証 | 得る属性 |
|---|---|---|---|
| ブラウザ | `?token=`（起動トークン） | HMAC 署名＋失効＋`driveFolderId===folderId` | `caseId`・`driveFolderId` |
| VM ワーカー | `x-proxy-secret` ヘッダ | `DRIVE_PROXY_SERVER_SECRET` 定時間比較 | （folder 制約なし・読取専用） |

- 起動トークン形式＝`base64url(payload).HMAC-SHA256(REPORT_LINK_SECRET, payload)`（`security/launch-token.ts`）。
- IAP（`@seibu-s.co.jp` SSO）がブラウザ経路の「誰か」を担保し、`X-Goog-Authenticated-User-Email` を付与（`security/iap-user.ts`）。
- 認可外＝**403**／資格なし＝**401**／未設定＝**503**／不正入力＝**400**。

---

## 2. エンドポイント

### 2-1. `GET /api/folder?folderId=&token=`（画像一覧・プロキシ）
```jsonc
// 200
{ "folderId": "<id>", "count": 12, "images": [ { "fileId": "...", "name": "DSC_0001.jpg", "mimeType": "image/jpeg" } ] }
```

### 2-2. `GET /api/photo?fileId=&folderId=&token=`（画像バイト・プロキシ）
- 200＝画像バイト（`Content-Type` 画像／キャッシュ制御付き）。`fileId` は当該 `folderId` 配下に限る。

### 2-3. `GET /api/photo-report?folderId=&caseId=&token=`（現在版の取得・プリフィル）
```jsonc
// 200 = PhotoReportView（src/lib/photo-report-source.ts）
{ "caseId": "...", "driveFolderId": "...", "headerSummary": "…",
  "photoItems": [ { "fileId": "...", "name": "...", "mimeType": "image/jpeg",
                    "heading": "…", "annotationNote": "…", "annotations": [] } ] }
```
- フォルダ画像 ＋ Supabase `photo_reports`（現在版）を `overlayReport` で重ねた結果。`caseId` は token 由来を採用。

### 2-4. `POST /api/photo-report/save?folderId=&token=`（保存＝新版・ブラウザのみ）
```jsonc
// body
{ "report": { /* photoReportDraftSchema 準拠 */ }, "label": "顧客確認用?", "note": "?" }
// 200
{ "version": 3, "fileName": "v0003.json", "savedAt": "2026-06-19T08:00:00.000Z" }
```
- `report.caseId`/`driveFolderId` は**サーバーが認可済み値で上書き**（ボディを信用しない）。
- `_ai/reports/<folder_id>/v{連番}.json`（append-only）を1つ書き、Supabase 現在版を upsert。`source=human`。

### 2-5. `GET /api/photo-report/versions?folderId=&token=`（版一覧）
```jsonc
// 200（新しい版が先頭）
{ "versions": [ { "version": 3, "fileId": "...", "modifiedTime": "...", "label": "顧客確認用", "createdBy": "user@seibu-s.co.jp" } ] }
```

### 2-6. `POST /api/photo-report/rollback?folderId=&token=`（ロールバック・ブラウザのみ）
```jsonc
{ "version": 1 }            // → 旧版の内容で新版を書く（1版＝監査）。200 は save と同形
```

### 2-7. `POST /api/photo-report/rename?folderId=&token=`（版名・ブラウザのみ）
```jsonc
{ "version": 2, "label": "提出版" }     // → Drive description のみ更新（本文不変）。200 { version, label }
```

### 2-8. `POST /api/photo-report/delete?folderId=&token=`（版削除・ブラウザのみ）
```jsonc
{ "version": 2 }            // → Drive ゴミ箱(trashed・復元可)。200 { version, trashed:true }
```
- **最新版は不可（409）／作成者本人のみ（403）**。

---

## 3. 不変条件（版管理・権限）

- **現在版＝Supabase `photo_reports`（folder_id・1件・上書き）**。Slack リンク先・ページ表示は常に現在版。
- **版履歴＝Drive `_ai/reports/<folder_id>/v*.json`（append-only・本文不変・自己記述）**。最新＝最大番号。
  ロールバックも「旧版の内容で新版を書く」＝1版として記録。中間版の欠番は許容（連番は最大＋1で単調）。
- **版名＝Drive `description`**（メタデータ・後編集可・本文に触れない）。**作成者＝IAP メール**を版JSON `createdBy`＋Drive `appProperties.createdBy` に記録。
- **削除＝Drive ゴミ箱（可逆）**・最新版不可・本人のみ。物理削除しない。

---

## 4. 既存実装へのマッピング（contract-by-extraction の肝）

| 契約 | 既存実装 |
|---|---|
| 認可（token/secret 出し分け） | `src/lib/security/proxy-auth.ts`・`launch-token.ts`・`iap-user.ts` |
| 画像プロキシ | `src/app/api/folder/route.ts`・`api/photo/route.ts`・`src/lib/drive.ts` |
| 現在版取得（overlay） | `src/app/api/photo-report/route.ts`・`src/lib/photo-report-source.ts` |
| 保存/版/ロールバック/版名/削除 | `src/app/api/photo-report/{save,versions,rollback,rename,delete}/route.ts` |
| 版の Drive 入出力・現在版 upsert | `src/lib/photo-report-store.ts`・`drive-write.ts`・`report-versions.ts`・`supabase-rest.ts` |
| AI 生成（書込み相手＝同テーブル/同フォルダ規約） | `worker/photo-report-worker.mjs`（readonly Drive＋`photo_reports` upsert `source=ai`） |

- 冪等・必須チェック・上書き規約は実装の挙動をそのまま写す（新規発明しない）。

---

## 関連

- [D-PORTS](../../../decisions.md) / [PORTS.md](../../../PORTS.md) §5
- 正本アーキ：`../architecture/slack-photo-report-architecture.md`（§5 版管理 / §8 セキュリティ）
- 横断（digest）：`../../../contracts/case-digest/`
