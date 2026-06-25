-- Slack写真報告書 用テーブル
-- 仕様(正本): docs/architecture/slack-photo-report-architecture.md / 実装計画 docs/spec/photo-report/slack-photo-report-impl-plan.md
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
  notified_at   timestamptz,                     -- 完了返信(3c)済み時刻。done検知→スレ通知後にセット。再投入時はnullへ
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- 既存テーブルへの後追い適用（3c 完了返信）は migration を使う:
--   migrations/20260619170500_add_notified_at_to_photo_report_jobs.sql
create index if not exists idx_photo_report_jobs_status on photo_report_jobs (status, created_at);

-- 2) 生成物：report JSON（写真ごとの見出し/注記(annotations)/並び＋要約）。folder 単位で「現在版1件」のみ・再生成/編集で上書き。
--    版履歴は Drive `_ai/reports/<folder_id>/v*.json`(append-only) に report-app が書く（正本アーキ §5）。ここは常に最新版。
create table if not exists photo_reports (
  folder_id     text primary key,                -- Drive フォルダ＝報告書の単位
  case_id       text,
  report_json   jsonb not null,                  -- photoReportDraftSchema 準拠（fileId 参照・実画像は持たない）
  source        text not null default 'ai',      -- ai（ワーカー再生成）/ human（人の保存・ロールバック）
  generated_at  timestamptz not null default now()
);

-- 3) 生成設定：報告書の種類/実施日/物件名/担当者＋AI文章のトーン。設定モーダルが upsert、ワーカーが読む。
--    （差分適用は migrations/20260619210000_create_photo_report_settings.sql）
create table if not exists photo_report_settings (
  folder_id        text primary key,
  report_type      text not null default 'construction', -- construction(施工) / survey(調査)
  exec_date        text,                                 -- 実施日（当面手入力）
  property_name    text,                                 -- 物件名（将来 JUST.DB 取得）
  reporter         text,                                 -- 担当者（表紙フッター）
  tone_politeness  text not null default 'desu_masu',    -- desu_masu / plain
  response_mode    text not null default 'normal',       -- normal / complaint
  proposal_weight  text not null default 'normal',       -- strong / normal / light
  client_type      text not null default 'corporate',    -- corporate / individual
  updated_at       timestamptz not null default now()
);

-- 4) RLS：public/anon からは触らせない（service_role はRLSをバイパスするのでサーバーからは読み書き可）。
alter table photo_report_jobs     enable row level security;
alter table photo_reports         enable row level security;
alter table photo_report_settings enable row level security;

-- 補足：写真の実体・実画像は Drive が正本（ここには入れない）。report_json は fileId 参照のみ。
