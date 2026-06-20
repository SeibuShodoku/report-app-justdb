-- Migration: case_digest_jobs D2 拡張（統一正本モデル・GAS 切替 / D-DIGEST Phase D2）
-- 正本仕様: contracts/case-digest/CASE_DIGEST_DRAFT.md §4-§5 / 手順: contracts/case-digest/D2_IMPLEMENTATION_PLAN.md
-- 追加列:
--   absorbed_ts : VM が done 時に書く「Slack をどこまで吸収したか」の ts。GAS が次サイクルの Slack 取得起点に読む。
--                 （カーソルの正本は digest.md 末尾 `slack-absorbed-ts`。本列はその写しで、GAS が Drive を読まず済む。）
--   applied_at  : GAS が result_summary をトピック備考へ chat.update 済みにした時刻。
--                 status=done AND applied_at IS NULL を「未適用キュー」として引く。

alter table case_digest_jobs add column if not exists absorbed_ts text;
alter table case_digest_jobs add column if not exists applied_at  timestamptz;

-- 未適用キュー取得用（status=done AND applied_at is null を新しい順に引く）。
create index if not exists idx_case_digest_jobs_apply
  on case_digest_jobs (status, applied_at, created_at);

comment on column case_digest_jobs.absorbed_ts is
  'VM が done 時に書く「Slack をどこまで吸収したか」の ts。GAS が次サイクルの Slack 取得起点に読む（カーソルの正本は digest.md・slack-absorbed-ts、本列はその写し）。D-DIGEST/D2。';
comment on column case_digest_jobs.applied_at is
  'GAS が result_summary をトピック備考へ chat.update 済みにした時刻。status=done AND applied_at IS NULL を未適用キューとして引く。D2。';
