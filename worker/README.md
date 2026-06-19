# photo-report-worker（写真報告書 AI ワーカー・フェーズ2）

VM 常駐で動かす。queued ジョブを拾い、**Drive を直接読み**（mgmt-strat の OAuth・drive.readonly）、
**VM の Claude Code をヘッドレス起動**して `report.json` を書かせ、検証して Supabase `photo_reports` に保存する。

- 仕様/計画: `../docs/spec/slack-photo-report.md` / `../docs/spec/slack-photo-report-impl-plan.md` §2
- スキーマDDL（先に適用）: `../docs/supabase/slack-photo-report-schema.sql`
- **方式Y**：Cloud Run 直結IAP がヘッドレス用 audience を露出しないため、worker は IAP 越しプロキシではなく Drive 直読み。
  案件フォルダは mgmt-strat 所有ツリー配下なので、他者所有の写真も継承で読める（DWD不要）。
- Claude は **VM の Team サブスク認証**で動く（追加 APIキー不要・D-AIDATA）。

## 必要 env

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_ID=...                    # report-app の .env.local と同値（Drive読取OAuth）
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_REFRESH_TOKEN=...          # mgmt-strat・drive.readonly
# 任意
CLAUDE_BIN=claude
POLL_INTERVAL_MS=15000
MAX_PHOTOS=60
MAX_CONTEXT_DOCS=5
CLAUDE_TIMEOUT_MS=300000
MAX_ATTEMPTS=8        # 試行上限。到達ジョブは Claude を回さず error 確定（暴走防止）
```

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
