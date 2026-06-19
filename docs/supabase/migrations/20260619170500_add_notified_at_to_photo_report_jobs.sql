-- Migration: photo_report_jobs.notified_at を追加（3c 完了返信）
-- 目的: job done を検知して Slack スレッドへ「📝報告書を開く」を「1回だけ」投稿するための通知済みフラグ。
--       再投入(再生成)時は null に戻して再通知させる（hub-gas pr_reenqueueIfFinished_）。
-- 適用先: 写真報告 Supabase プロジェクト（ref = hnqmokrbgxxahmtoeryx）。※dispatch-app ではない。
-- 手段: Supabase ダッシュボード → SQL Editor に貼り付けて実行（本リポは CLI 未使用）。冪等・再実行可。

alter table photo_report_jobs
  add column if not exists notified_at timestamptz;

comment on column photo_report_jobs.notified_at is
  '完了返信(3c)済み時刻。done→Slackスレ通知後にセット／再投入時は null に戻す。';
