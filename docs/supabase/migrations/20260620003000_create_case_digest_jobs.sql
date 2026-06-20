-- Migration: case_digest_jobs（案件ダイジェスト“生成”ジョブ・D-DIGEST / Phase D1）
-- 写真の photo_report_jobs とは入出力もライフサイクルも違うため別テーブルにする。
-- producer = justdb-hub-gas（増分本文＋前回要約を投入）/ consumer = VM AI ワーカー（要約 → 口へ digest.md・job へ topic要約）。
-- 正本アーキ: docs/architecture/slack-photo-report-architecture.md §7 / 中央契約: contracts/case-digest/

create table if not exists case_digest_jobs (
  id             bigint generated always as identity primary key,
  dedupe_key     text not null unique,            -- 冪等キー（例 case:<caseId>:<runId> / cron:<caseId>:<yyyymmddHHMM>）
  case_id        text not null,                   -- 案件ID（PROJECT_NUMBER）
  folder_id      text not null,                   -- Drive 案件フォルダ（_ai/ の親。GD 書類の置き場）
  channel        text,                            -- Slack チャンネルID（任意）
  thread_ts      text,                            -- Slack スレッド ts（任意）
  slack_delta    text,                            -- GAS が取得した「未要約の増分スレ本文」（VM に Slack 権限を持たせない）
  prev_summary   text,                            -- 前回トピック備考要約（マージ入力）
  status         text not null default 'queued',  -- queued / processing / done / error
  error          text,                            -- 失敗時メッセージ
  attempts       int  not null default 0,
  result_summary text,                            -- VM が書く：トピック備考用の要約（GAS がポーリングして読む）
  digest_file_id text,                            -- 口経由で書いた digest.md の fileId（監査・任意）
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_case_digest_jobs_status on case_digest_jobs (status, created_at);

-- 写真系と同じく service_role のみが触る運用。RLS を有効化（ポリシー無し＝anon/auth は不可）。
alter table case_digest_jobs enable row level security;

comment on table case_digest_jobs is
  '案件ダイジェスト生成ジョブ。GAS が投入→VM ワーカーが要約→口(digest.md)＋result_summary(トピック備考用)。D-DIGEST。';
comment on column case_digest_jobs.slack_delta is
  'GAS が Slack から取得した未要約の増分本文。VM に Slack 資格情報を持たせないための受け渡し口。';
comment on column case_digest_jobs.result_summary is
  'VM が生成したトピック備考用要約。GAS が status=done をポーリングして読み、トピック備考を更新する。';
