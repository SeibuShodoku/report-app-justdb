# 写真報告書システム アーキテクチャ（統合・現況）

最終更新：2026-06-19
本書は「Slack写真→AI写真報告書」システムの**現時点の正本アーキ**。個別仕様は
`spec/slack-photo-report.md`（初期仕様・一部は本書が上書き）／`spec/slack-photo-report-impl-plan.md`（実装計画）／
`deployment.md`（資源の所在）。横断方針は root `decisions.md`（D-AIDATA / D-PORTS）。

## 1. 目的
案件の現場写真から、AI が**写真報告書の下書き**を作る。人は WEB で赤丸・微修正して PDF 化。
精度は「写真だけ」に頼らず、**案件の文脈（GD書類＋Slackスレッド）**で補う。

## 2. コンポーネントと責務

| コンポーネント | 置き場 | 責務 |
|---|---|---|
| **report-app（WEB/BFF）** | Cloud Run `report-app-justdb`＋**IAP**（@seibu-s.co.jp）/ seibu-dispatch-poc-tky | 写真報告書の表示・編集・PDF出力（`/report/photo`）。画像プロキシ（`/api/folder`・`/api/photo`）。report JSON 取込（`photo_reports`）。**「口」=AI成果物の永続/提供（後述）** |
| **AIワーカー** | VM（seibot-proxy）`/mnt/claude-data/projects/photo-report-worker` 常駐 | `photo_report_jobs` を拾い、**Drive直読み**で写真取得→**VMのClaude Code(headless)**で report.json 生成→`photo_reports` 保存 |
| **案件ダイジェスト要約** | 既存 `justdb-hub-gas/justdb-topic-digest-gas`（GAS・cron） | JUST.DB案件履歴ポーリング→案件スレッドを Claude で**マージ要約**（prev＋最新）→トピック備考更新。**要約の責務を一本化** |
| **Supabase** | 既存 | `photo_report_jobs`（ジョブ台帳）/ `photo_reports`（AI生成 report JSON）。マスタ等は既存 |
| **JUST.DB** | 既存 | 正本。案件一覧に **案件ID・GoogleDrive URL・Slack thread_ts/channel** を保持＝**案件↔フォルダ↔スレッドのマッピング正本** |
| **Slackトピック（案件スレッド）** | 既存 | 1案件1スレッド。案件ID・GD URL が必ず記載。写真報告のトリガー起点（Phase3） |
| **Google Drive** | 既存 | 案件フォルダ（ユーザーも触る）。配下に **AI専用サブフォルダ（mgmt限定ACL）**＝コアmd・Slack要約履歴md・整理済み写真 |

## 3. データフロー（全体）

```
                         ┌──────────────── JUST.DB（正本：案件ID/GD URL/thread_ts/channel）────────────────┐
                         │ 案件履歴ポーリング(既存)                                                          │
                         ▼                                                                                  │
[Slack案件スレッド]──▶ topic-digest-gas: 案件ごとにスレ増分を Claude マージ要約 ──▶ トピック備考更新(既存)   │
        │                       │ 要約コンテンツを引き渡し                                                  │
        │ (Phase3)              ▼                                                                            │
        │             ┌── report-app「口」(API) ◀── digest-gas が要約をPOST ──┐                            │
   トリガー            │   ・AI専用フォルダ作成(mgmt限定ACL)                    │                            │
   写真をGDへ          │   ・GD書類を“一度だけ”読む→既読化→コアmdに索引        │                            │
        │             │   ・コア案件ダイジェストmd / Slack要約履歴md を保守    │                            │
        ▼             └───────────────────────────┬──────────────────────────┘                            │
[案件GDフォルダ/写真]                              │ 保存                                                   │
        │                                          ▼                                                        │
        │                          [AI専用フォルダ: コアmd / Slack履歴md / 写真]                            │
        ▼ ジョブ投入(Phase3)                       │ worker が文脈として読む                                │
[photo_report_jobs]──▶ AIワーカー(VM): Drive直読みで写真＋コアmd取得 →Claude Code(headless)→ report.json     │
                                   └──────────────▶ [photo_reports] ──▶ report-app /report/photo（IAP/SSO） │
                                                                          人が赤丸・微修正・PDF ─────────────┘
```

## 4. 案件ダイジェスト統合（役割分担）
- **要約は digest-gas に一本化**（Slackスレッドのマージ要約は既存の強み。重複させない）。
- **「口」は report-app 側に作って提供**（責務が明確。深い融合＝digest-gasが直接Drive管理、は将来“統合権限”で）。
  - digest-gas は要約コンテンツを report-app の「口」へ渡すだけ。
  - report-app の「口」が **AI専用フォルダの作成・コアmd/Slack履歴md の保守・GD書類の既読管理**を担う（report-app は Drive アクセスを持つ層）。
- **GD書類は“一度読んだら既読”**にし、コアmdには**索引（名前・日付・種別＋要点）**だけ持つ（欲張らない）。
- **Slack要約md は別ファイル＋時系列履歴**（トピックは上書きで履歴が消えるため、md側に残す）。
- 「口」は **seibot-proxy（HMAC）等あらゆる既存資産**を使ってよい。
- ワーカーは要約しない＝**コアmd を読むだけ**（トークン安定・時系列一貫）。

## 5. デプロイ・セキュリティ
- report-app＝Cloud Run＋**IAP（@seibu-s.co.jp 限定 SSO）**。秘密は Cloud Run env。
- **Drive 認証＝mgmt-strat の OAuth**（案件フォルダは mgmt-strat 所有ツリー配下→他者所有写真も継承で読める。DWD不要）。
  - 現状 **drive.readonly**。AI専用フォルダ作成・md書込みには**書込みスコープが必要**（要・スコープ拡張＝再同意）。
- VM ワーカーは Drive直読み（IAP越え不可のため）。Claude は **Team/API 認証必須**（D-AIDATA）。
- 顧客写真を Claude に渡すのは D-AIDATA で許可（学習不使用の閉空間＝Team/API）。

## 6. 継ぎ目（D-PORTS・契約候補）
| 継ぎ目 | 種別 |
|---|---|
| Slack ⇄ ロジック（slack-mini-bolt） | 既存 |
| アプリ ⇄ セキュリティ（seibot-proxy・HMAC） | 既存 |
| JUST.DB ⇄ 利用側 | 既存（中央 `contracts/justdb/`） |
| 画像プロキシ＋report JSON（report-app ⇄ ブラウザ/ワーカー） | 新規（稼働後に契約抽出） |
| **digest-gas ⇄ report-app「口」**（要約引き渡し・共用md仕様） | **新規・要契約化** |

## 7. 状態
- ✅ **M1**（WEB単体：実フォルダ→`/report/photo` プリフィル＋PDF）。
- ✅ **M2**（Slack抜きE2E：ジョブ→ワーカー→Drive直読み→Claude Code→report.json→保存）。文脈PDF同梱で精度向上（クマネズミ案件を正しく特定）。
- ⬜ 案件ダイジェスト統合（本書 §4）。
- ⬜ Phase3（Slackトリガー：案件スレッド→フォルダ→ボタン→ジョブ投入→URL返信）。

## 8. 決定ログ（要点）
- **D-AIDATA**：顧客データは Team/API（閉空間）へなら渡してよい。
- **Drive＝外部SA不可→社内OAuth（mgmt-strat）**：Workspaceが外部に継承を波及させないため。
- **方式Y**：Cloud Run直結IAPがヘッドレス用audienceを露出しない→ワーカーはDrive直読み。IAPはブラウザ保護。
- **デプロイ＝Cloud Run＋IAP**（Vercel Hobbyは非商用不可で却下）。
- **マッピング＝JUST.DB案件一覧**（新規基盤不要）。
- **ダイジェスト＝要約はdigest-gas／永続の「口」はreport-app側**（責務分離）。GD書類は既読化＋索引。
