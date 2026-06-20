-- 防除作業報告書（紺谷V）の現在版（folder_id 単位）。写真報告書 photo_reports と同型・別テーブル。
-- 版履歴は Drive _ai/reports/<folder_id>/v*.json（append-only）。本表は現在版の射影。
-- 仕様: docs/spec/ring1a-prevention-report.md
create table if not exists prevention_reports (
  folder_id        text primary key,                -- Drive フォルダ＝報告書の単位（写真と同機構）
  case_id          text,
  construction_id  text,
  report_json      jsonb not null,                  -- PreventionReportDraft
  source           text not null default 'human',   -- 'human'（防除は人入力）/ 'ai'（将来）
  generated_at     timestamptz not null default now()
);

-- RLS：public/anon からは触らせない（service_role はバイパス＝サーバーから読み書き可）。
alter table prevention_reports enable row level security;
