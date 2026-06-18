-- Slack写真報告書 用テーブル
-- 仕様: docs/spec/slack-photo-report.md / 実装計画 docs/spec/slack-photo-report-impl-plan.md §1c・§2
-- report-app(サーバー) と VM 常駐ワーカーが PostgREST 経由で参照する。既存スキーマとは独立。
-- 適用: Supabase の SQL エディタ等で実行。アクセスは service_role（サーバー専用）想定＝RLSは有効化し公開アクセスは塞ぐ。

-- 1) ジョブ台帳：Slackの[作成]ボタン or 手動投入で1行。VMワーカーが queued を拾って処理する。
create table if not exists photo_report_jobs (
  id            bigint generated always as identity primary key,
  dedupe_key    text not null unique,            -- 冪等キー（Slack=channel:thread_ts:folder_id / 手動=folder_id 等）
  channel       text,                            -- Slack チャンネルID（手動投入時は null 可）
  thread_ts     text,                            -- Slack スレッド ts（同上）
  folder_id     text not null,                   -- Drive フォルダ（写真の置き場）
  case_id       text,                            -- 案件ID（任意）
  status        text not null default 'queued',  -- queued / processing / done / error
  error         text,                            -- 失敗時のメッセージ
  attempts      int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_photo_report_jobs_status on photo_report_jobs (status, created_at);

-- 2) 生成物：AI が作った report JSON（写真ごとの見出し/注記/並び＋要約）。folder 単位で1件、再生成は上書き。
create table if not exists photo_reports (
  folder_id     text primary key,                -- Drive フォルダ＝報告書の単位
  case_id       text,
  report_json   jsonb not null,                  -- photoReportDraftSchema 準拠（fileId 参照・実画像は持たない）
  source        text not null default 'ai',      -- ai / manual
  generated_at  timestamptz not null default now()
);

-- 3) RLS：public/anon からは触らせない（service_role はRLSをバイパスするのでサーバーからは読み書き可）。
alter table photo_report_jobs enable row level security;
alter table photo_reports     enable row level security;

-- 補足：写真の実体・実画像は Drive が正本（ここには入れない）。report_json は fileId 参照のみ。
