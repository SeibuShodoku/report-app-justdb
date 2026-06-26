# AI ワーカー（写真報告＋案件ダイジェスト・VM 常駐）

VM 常駐で動かす。**2つのジョブ型を1プロセスで捌く**（D-DIGEST）。Drive は **mgmt-strat の OAuth `drive`(RW)** で直接アクセス。

- **写真報告 `photo_report_jobs`**：写真＋文脈(_ai/digest.md or PDF) を読み、Claude Code(headless) で `report.json` を生成 → Supabase `photo_reports` に保存。
- **案件ダイジェスト `case_digest_jobs`（Phase D1→D2 統一正本モデル）**：GAS が投入（構造化 `slack_delta`＋前回備考 `prev_summary`）→ 未読書類＋Slack増分を畳み込み、**`_ai/digest.md`（重要情報（固定）／経緯（時系列）／既読書類索引）を Drive 直書き（Option A）**。
  - digest.md 末尾に**2カーソル同居**：既読書類ID `<!-- digest-read-doc-ids: … -->` ＋ 吸収済Slack ts `<!-- slack-absorbed-ts: … -->`（カーソルも AI 所有）。
  - 出力 `result_summary`＝**固定的な重要情報カード**（GAS が備考に反映）。構造化データ（受注金額等）は除外。`absorbed_ts` を job に書き、**畳み込み後 `slack_delta` を null で破棄**（短命）。
  - ループは写真優先→無ければ digest を1件。`drive`(RW) は digest 直書き用（**版スナップショットの書き手は report-app のみ**＝据置）。

- 仕様/計画: `../docs/architecture/slack-photo-report-architecture.md`（正本・§7）/ `../docs/spec/photo-report/slack-photo-report-impl-plan.md` §2・§6 / 中央契約 `../../contracts/case-digest/`
- スキーマDDL（先に適用）: `../docs/supabase/slack-photo-report-schema.sql`＋`../docs/supabase/migrations/20260620003000_create_case_digest_jobs.sql`
- **方式Y**：Cloud Run 直結IAP がヘッドレス用 audience を露出しない（統合IAPはプログラム的 audience を受けない＝実測確定）ため、worker は IAP 越しプロキシではなく Drive 直アクセス。案件フォルダは mgmt-strat 所有ツリー配下なので継承で読める（DWD不要）。
- Claude は **VM の Team サブスク認証**で動く（追加 APIキー不要・D-AIDATA）。

## 必要 env

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_ID=...                    # report-app と同値
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...          # mgmt-strat・drive(RW)。report-app の RW トークンを流用（digest 直書き用）
# 任意
CLAUDE_BIN=claude
CLAUDE_MODEL=claude-opus-4-8   # 既定モデル（写真+ダイジェスト共通・per-run）。alias opus/sonnet/fable も可
CLAUDE_EFFORT=medium           # 既定エフォート。low/medium/high/xhigh/max
POLL_INTERVAL_MS=15000
MAX_PHOTOS=60
MAX_CONTEXT_DOCS=5
MAX_DIGEST_DOCS=6     # ダイジェスト1回で新規に読む未読書類の上限（既読は再読しない）
CLAUDE_TIMEOUT_MS=300000
MAX_ATTEMPTS=8        # 試行上限。到達ジョブは Claude を回さず error 確定（暴走防止）
# アカウント・フォールバック（mgmt の週次使用上限対策・sentinel と同じ考え方）
CLAUDE_CONFIG_DIR=             # primary(mgmt) の資格情報ディレクトリ。空＝claude既定(~/.claude)
CLAUDE_CONFIG_DIR_FALLBACK=    # 2nd(ishibashi) の資格情報ディレクトリ。設定すると primary 失敗時に無言で切替。空＝無効
```

> 既定は **Opus 4.8 / effort medium**（文脈が育つほど深い思考は不要、の方針）。env で上書き可。sentinel の夜間学習は別プロジェクト（`run-nightly.sh`＝Opus 4.8 / xhigh）。
>
> **アカウント・フォールバック**：`CLAUDE_CONFIG_DIR_FALLBACK` を ishibashi アカウントの資格情報ディレクトリ（別途 `CLAUDE_CONFIG_DIR=<その場所> claude login` で作成）に向けると、**mgmt が週次上限に達して `claude` が失敗したとき、無言で ishibashi アカウントへ切り替えて再実行**する（報告書・ダイジェスト共通）。タイムアウトは切替しない（上限超過は即失敗で来るため）。未設定なら従来どおり1アカウントのみ。

VM では秘密を `worker.env`（mode 600・KEY=value 形式）に置き、`run.sh` が `set -a; . ./worker.env` で読み込む。

## 実行（VM・systemd 常駐＝正本）

tmux 手動常駐はプロセス/VM 落ちで止まるため、**systemd で自動再起動**する（`photo-report-worker.service` がユニットの正本）。

```bash
# 設置（VM・mgmt-strat で sudo 可）
sudo cp /mnt/claude-data/projects/photo-report-worker/photo-report-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now photo-report-worker      # 起動＋次回ブートでも自動起動
systemctl status photo-report-worker --no-pager      # active(running) を確認
tail -f /mnt/claude-data/projects/photo-report-worker/worker.log

# 更新時（worker コード差し替え後）
sudo systemctl restart photo-report-worker
```

> 単発デバッグだけなら `bash run.sh`（前景）でも可。常駐の正本は systemd。

## M2（Slack 抜き E2E）手順

1. `docs/supabase/slack-photo-report-schema.sql` を Supabase に適用。
2. Claude Code が VM に入っており `claude` が PATH 上にある（ログイン済み＝Team）。
3. ジョブを1件手動投入（例。folder は写真の入った Drive フォルダ）:
   ```sql
   insert into photo_report_jobs (dedupe_key, folder_id, case_id)
   values ('manual:1Xh3Y…', '1Xh3YpmburdGm98gOGZxsiuPb-VqlgLj3', 'CASE-TEST');
   ```
4. ワーカーを起動 → `photo_reports` に report_json が入り、ジョブが done になる。
5. `/report/photo?folderId=…&caseId=…&token=…` を開くと **AI の見出し・注記でプリフィル**される（M2 達成）。

## 既知の調整ポイント
- Claude Code ヘッドレスのフラグ（`-p` / `--permission-mode` 等）はバージョン差があるため、VM で `claude --help` を見て最終調整する（report.json を権限プロンプト無しで書けること）。
- 写真が多いと1回の生成でサブスク利用量を消費する。`MAX_PHOTOS` で上限。
- report.json の検証スキーマは `src/schemas/photo-report.ts` のミラー（worker を素の node で動かすため再掲）。将来一本化を検討。
