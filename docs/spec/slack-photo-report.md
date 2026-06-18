# 写真報告書 自動生成（Slack 起点）仕様書 v0.1

最終更新：2026-06-18
状態：**draft**（設計収束・未実装）

Slack に写真を集め、AI がスレッド文脈＋写真から**写真報告書の下書き（report JSON）**を作り、
本アプリ（`report-app-justdb`）の WEB 報告書として**プリフィル済み**で開けるようにする自動化レイヤの仕様。
本書は本アプリ既存仕様（`spec/requirements.md` ／ `spec/report-formats.md` §3 写真報告書 ／ `architecture/overview.md`）を
**前提**とし、それを置き換えない。新規の報告書様式は作らない＝**既存の写真報告書を自動で埋める**。

---

## 1. 目的・狙い

- 現場が Slack で写真を出すだけで、写真報告書の**叩き台**が自動で立ち上がる。
- AI は「写真の見出し・注記・並び・要約」という**中身**を作り、清書・赤丸・PDF 化は既存 WEB が担う（出力を安定させる役割分担）。
- 「枚数」「いつ揃ったか」を機械が推測しない。**人の明示操作（ボタン）を完了の合図**にする。

## 2. スコープ

### 2.1 対象
- Slack トリガー → Drive フォルダ用意 → 写真投入 → 「作成」ボタン → AI 生成 → WEB URL 返信、までの一連。
- AI による report JSON 生成（写真ごとの `heading` / `annotationNote`、並び、`headerSummary`）。
- 本アプリ側の **report JSON 取り込み（プリフィル）** と **画像プロキシ BFF**（Drive 私的画像を WEB/AI に供給）。

### 2.2 非対象（現時点）
- 赤丸注記の自動描画（AI は注記**文**まで。描画は人が WEB で。実装自体は本アプリ既存 open-issue）。
- JUST.DB への書き戻し（本フローでは任意。やるなら既存の限定書き戻し方針に従う）。
- Slack を写真の保管先にすること（後述の通り写真は Drive 直投入が基本）。

## 3. 全体フロー（誰が何をするか）

```
   [Slack]                         [GAS: slack-mini-bolt]            [Google Drive]        [VM: 常駐Claude]     [WEB: report-app-justdb]
 1 トリガー(ショートカット/コマンド) ─▶ 受信・即ACK
 2                                    フォルダ作成(命名規則) ───────▶ 案件フォルダ/子フォルダ
 3 スレッドに「📁ここへ保存」+[作成]◀─ リンク+ボタン投稿
 4 現場が写真を直接アップ ───────────────────────────────────────▶ フォルダに写真(枚数無制限)
 5 [作成]クリック ─────────────────▶ 即ACK + ジョブ投入 ──────────────────────────────────▶ ジョブ検知
 6                                                                  写真一覧/実体 ◀──(画像プロキシ)── AI が読む
 7                                                                                            report JSON 生成
 8                                                                  JSON 保存 ◀───────────── 置き場へ書く
 9 完成URLをスレッド返信 ◀────────── (URL組立/投稿) ◀────────────────────────────────────── 完了通知
10 人がURLを開く ──────────────────────────────────────────────────────────────────────▶ プリフィル表示→赤丸/微修正→PDF保存
```

### 役割分担（D-PORTS / D-AIDATA 準拠）
| 層 | 役割 | 認証情報 |
|---|---|---|
| **GAS（`slack-mini-bolt` 資産）** | Slack 入出力（トリガー受け・3秒ACK・ボタン・URL返信）＋ **Drive フォルダ作成**（`driveUtils.gs`、所有者権限で追加認証不要） | Slack Bot Token / GAS 所有者の Drive |
| **VM（常駐 Claude）** | **AI のみ**：写真＋スレッド文脈 → report JSON | **Google 資格情報ゼロ**。Slack 取得も基本 GAS 側。Claude は Team/API（D-AIDATA） |
| **WEB（`report-app-justdb`）** | 編集・出力面＋**画像プロキシ BFF**＋report JSON 取り込み | Supabase サービスロール＋**Drive 資格情報（SA）をここに集約** |

## 4. 写真の入れ方（10枚問題の解消）

- 写真は **Drive フォルダへ直接アップロード**（Drive アプリ/Web）。Slack の「10 枚/投稿」「`files` 取得」制約を**まるごと回避**＝枚数無制限。
- Slack の役目は **(a) トリガー (b) 保存先リンク提示 (c) 完了ボタン (d) 完成 URL 返信** に限定。
- フォルダは「トピックの既存親フォルダ（案件単位）配下に、トリガーが報告書ごとの子フォルダを切る」。命名規則は §9 未確定。
- 補足: Slack を入口に残す場合のみ「スレッド全集約（`conversations.replies` をページングで全件・`file.id` で重複排除・`created` で整列）」を併用しうるが、本線は Drive 直投入。
  - 参考: Slack モーダルの `file_input` も `max_files` 最大 10 で 10 枚の壁は同じ。多枚数画像は WEB 面で扱う。

## 5. 完了の合図と 3 秒 ACK

- **完了＝「作成」ボタン押下**（`block_actions`）。これにより枚数推測・静止判定が不要。
- Slack の 3 秒応答要件：ボタン/コマンドは **即 ACK（「作成中…」）→ ジョブ投入** の非同期で受ける。
  これは `seibot-proxy` / `slack-mini-bolt` の Proxy 契約（3秒・`__proxy_action`・DRY_RUN）が既に想定する作りに乗る（PORTS §1, §2）。
- 進捗 UX：元メッセージを `chat.update` で「作成中…→✅完成 <URL>」に更新する案（実装で確定）。

## 6. データモデル（既存スキーマに乗る）

- **起動コンテキスト** = 既存 `launchContextSchema`：`caseId` ＋ `driveFolderId`/`driveFolderUrl` ＋ `token`（＋ `investigationId`/`constructionId`）。
  「この Drive フォルダを指して WEB 報告書を開く」は既にこの契約。
- **AI 生成物 = report JSON**：写真ごとに既存 `reportPhotoItemSchema` の `{ heading, imageUrl, annotationNote }`、加えて並び順と `headerSummary`（既存 `reportSubmissionSchema` 相当）。
  `imageUrl` は §7 の画像プロキシ URL（`/api/photo?fileId=…`）を指す。
- **report JSON の置き場**（§9 で確定）：
  - 案 A：Drive フォルダ内の再編集 JSON（`report-formats.md` §7 と同じ器）。WEB は `folderId` から読む。
  - 案 B：Supabase（本アプリが既に接続）。起動 URL の `token`＋`caseId` で引く。

## 7. 画像供給：画像プロキシ BFF（本仕様の肝）

私的 Drive の写真をブラウザにも AI にも出すため、**Drive 資格情報を本アプリサーバー 1 か所に集約**し、HTTP で供給する。
**VM も browser も Drive を直接叩かない。**

```
Drive ──(プロキシが Drive API)──▶ report-app-justdb(サーバー) ──HTTP──▶ {ブラウザ <img> / VMのAI fetch}
        ▲ ここだけ Google 資格情報(SA)                                  ▲ どちらも資格情報ゼロ
```

| エンドポイント | 内部 Drive API | 用途 |
|---|---|---|
| `GET /api/folder?folderId=…` | `files.list`（`'FID' in parents and mimeType contains 'image/'`, `orderBy=createdTime`, 共有Driveは `supportsAllDrives=true`） | 写真一覧（fileId/name/mime/created） |
| `GET /api/photo?fileId=…` | `files.get?alt=media` | 画像バイト（Content-Type 付き・ストリーム） |

- **認証（同一エンドポイントを 2 種が叩くので入口で出し分け）**
  - ブラウザ：`launchContext.token`（既存 `src/lib/security/launch-token.ts` ／ `REPORT_LINK_SECRET`）。**トークンが許可するフォルダの画像しか返さない**＝プロキシが権限境界も兼ねる。
  - VM：サーバー間用の共有シークレット。
- **Drive 資格情報**：サーバー間用に **サービスアカウント（SA 鍵）**。対象が共有ドライブならメンバー追加、マイドライブ配下なら親フォルダを SA に共有。
  （このパターンは visit-planner の「ライブ参照 BFF」と同型。）

## 8. データ方針・非機能

- **AI へ写真を渡してよい**（[D-AIDATA](../../../decisions.md)）。**条件＝この Claude は必ず Team/API 認証**（VM 常駐は Team アカウント＝充足）。retention は短期許容、嫌なら ZDR。
- **冪等性**：ジョブは `(channel, thread_ts, folderId)` をキーに重複実行を防ぐ。再押下は最新写真で再生成（上書き）。
- **JUST.DB 予算（5000/日）への配慮**：本フローは Drive＋Supabase＋AI が主で、JUST.DB は基本叩かない。書き戻しは任意・限定（`requirements.md` §4）。`open-issues.md` §0 の予算ブロッカーと干渉しない設計。
- **監査ログ**：作成者・日時・案件 ID・フォルダ ID（`requirements.md` §6 に準拠）。
- **失敗時**：部分成功を記録し再実行可能に（写真欠落・AI 失敗・保存失敗）。

## 9. 契約・継ぎ目（D-PORTS）

本システムが触る継ぎ目と、契約の扱い：

| 継ぎ目 | 種別 | 契約の扱い |
|---|---|---|
| Slack ⇄ ロジック | 既存（PORTS §1, `slack-mini-bolt`） | 既存正本契約 `proxy-contract.md` に準拠。新規ハンドラを足すだけ。 |
| アプリ ⇄ セキュリティ | 既存（PORTS §2, `seibot-proxy`） | 既存 `API_SPEC.md` に準拠（Slack 署名検証・HMAC）。 |
| **画像プロキシ ＋ report JSON 取り込み**（WEB ⇄ VM/ブラウザ） | **新規（フロント⇄バック型, PORTS §4）** | **実装後に契約抽出**（contract-by-extraction）。本書 §6/§7 が抽出の素。稼働したら本アプリ `docs/` に `*_CONTRACT.md` を起こし PORTS §4 に登録。 |
| JUST.DB ⇄ 利用側 | 既存（PORTS §3, 中央 `contracts/justdb/`） | 書き戻しする場合のみ準拠。本フローでは任意。 |

## 10. 未確定（→ 解決したら本書/`open-issues.md` に反映）

1. **トリガー方式**：メッセージショートカット（スレッド ts を取れる）か スラッシュコマンドか。スレッド紐付けの確実性で前者有利。
2. **フォルダ命名規則**と親（トピックの既存フォルダ）の解決方法（リンク抽出 or 規則生成）。
3. **report JSON 置き場**：Drive（§6 案 A）か Supabase（案 B）か。
4. **ジョブ置き場**：Supabase テーブル行 か Drive の manifest.json か。VM のポーリング間隔。
5. **Drive 資格情報の正体**：SA の所属（共有ドライブ／DWD）と権限スコープ。
6. **写真の前処理**：プロキシ側 or VM 側でのリサイズ/圧縮（容量・vision コスト）。
7. **完成 UX**：`chat.update` での進捗表示か新規メッセージか。PDF リンクの返し方。

## 11. 関連

- 本アプリ：`spec/requirements.md` ／ `spec/report-formats.md`（§3 写真報告書） ／ `architecture/overview.md`
- 横断：[`decisions.md` D-AIDATA](../../../decisions.md)（顧客写真を AI へ）, [D-PORTS](../../../decisions.md), [`PORTS.md`](../../../PORTS.md)
- 基盤：`GCP_VM_Claude_構築手順.md`（VM 常駐 Claude） ／ `slack-mini-bolt`（Slack/Drive 資産） ／ `seibot-proxy`（署名ゲートウェイ）
- 実装計画：`spec/slack-photo-report-impl-plan.md`
