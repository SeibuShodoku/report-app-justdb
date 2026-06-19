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
  - 各版は**書いたら不変**（過去版を書き換えない＝履歴の完全性／同時編集での破壊を回避）。最新＝最大番号。
  - **保存** → `v{次番号}.json` を追記 ＋ Supabase を上書き。**ロールバック** → 旧版の内容で `v{次番号}.json` を**新規に書く** ＋ Supabase 更新（ロールバックも1版として記録＝監査に強い）。
  - 各版ファイルは自己記述（`version`/`generated_at`/`source`=ai|human/`note`/`folderName`/`report`）。可変なインデックスファイルは持たない。
  - **書くのは report-app**（RW トークン保有）。**ワーカーは readonly のまま**＝VM→Cloud Run の IAP 越え不要・権限拡大なし。
- **PDF はシステムでは生成・保管しない**。人が WEB から任意で印刷。複数報告書の取り回し・恒久保管は人の運用（PDF）に委ねる。

## 6. 赤丸など注記（annotations）
- 写真ピクセルは**編集しない**。赤丸・矢印・線・フリーハンド・テキストは**JSONのオーバーレイ**として持つ（`report-formats.md` §3）。
  - 入力＝**Pointer Events**（マウス/指/ペン統一）、描画＝写真上の**透明SVGレイヤー**（ベクター・各図形が要素＝選択/削除容易・印刷でも崩れない）。
  - 座標は**0〜1の正規化値**（表示サイズ・プロキシのリサイズに非依存で写真にピタリと重なる）。
  - 基本図形は**画像ファイル不要**（幾何データのみ）。再利用スタンプを使う時だけ `{type:"stamp", asset:"名前", …}` で名前参照。
- スキーマ予約：`photoReportDraftSchema` の各写真に **`annotations: []`** を持たせる（UI は後フェーズでも、版に乗るよう先に予約）。
- UNDO/REDO は配列の push/pop＝**画像UNDOの煩雑さなし**。注記は report JSON の一部なので**版管理に自動で乗り、ロールバックで赤丸も一緒に戻る**。

## 7. 案件ダイジェスト統合（役割分担）
- **要約は digest-gas に一本化**（Slackスレッドのマージ要約は既存の強み。重複させない）。
- **「口」は report-app 側**（Drive アクセスを持つ層）。digest-gas は要約コンテンツを「口」へ渡すだけ。「口」が **`_ai/` の作成・digest.md/slack履歴md の保守・GD書類の既読索引**を担う。
- **GD書類は“一度読んだら既読”**、コアmdには**索引（名前・日付・種別＋要点）**だけ（欲張らない）。**Slack要約md は別ファイル＋時系列履歴**。
- ワーカーは要約しない＝**digest.md を読むだけ**（トークン安定・時系列一貫）。
- `_ai/` は digest と **report 版履歴（§5）**の両方を収容する AI 管理フォルダ。

## 8. デプロイ・セキュリティ
- report-app＝Cloud Run＋**IAP（@seibu-s.co.jp 限定 SSO）**。秘密は Cloud Run env。
- **Drive 認証＝mgmt-strat の OAuth**（案件フォルダは mgmt-strat 所有ツリー配下→他者所有写真も継承で読める。DWD不要）。
  - report-app は **`drive` full（RW）**＝版スナップショット・「口」の書込み用。**ワーカーは `drive.readonly` 据置**。
- VM ワーカーは Drive直読み（IAP越え不可のため）。Claude は **Team/API 認証必須**（D-AIDATA）。
- 顧客写真を Claude に渡すのは D-AIDATA で許可（学習不使用の閉空間＝Team/API）。
- hub-gas Script Properties：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `PHOTO_REPORT_TESTERS`（テスト中はテスター以外のボタン押下を即 return）。

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
- ⬜ **完了返信**：done 検知→スレッドへ最新報告書URLを1本（期限切れ回避のため**ボタン→クリック時URL発行**）。
- ⬜ **版管理（report-app）**：`_ai/reports/<id>/v*.json` 追記＋Supabase差替＋ロールバックUI。
- ⬜ **annotations UI**（§6・スキーマ予約は先行）。
- ⬜ **ダイジェスト“生成”**（最終融合・IAP 解決）。

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
- **ダイジェスト＝要約はdigest-gas／永続の「口」はreport-app側**（責務分離）。GD書類は既読化＋索引。
