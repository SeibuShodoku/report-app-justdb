-- 写真報告書の生成設定（folder_id 単位）。
-- report-app の設定モーダルが upsert し、VM ワーカーが生成時に読んで Claude プロンプトへ反映する。
-- 仕様: docs/architecture/slack-photo-report-architecture.md §6.5 / ゴール＝齋藤マンション様 PDF
create table if not exists photo_report_settings (
  folder_id        text primary key,                     -- Drive 写真サブフォルダ＝報告書の単位
  report_type      text not null default 'construction', -- construction(施工) / survey(調査)
  exec_date        text,                                 -- 実施日（当面手入力・例 "2026年6月19日"）
  property_name    text,                                 -- 物件名（将来 JUST.DB から取得）
  reporter         text,                                 -- 担当者（表紙フッター）
  tone_politeness  text not null default 'desu_masu',    -- desu_masu(ですます調) / plain(言い切り調)
  response_mode    text not null default 'normal',       -- normal(通常対応) / complaint(クレーム対応)
  proposal_weight  text not null default 'normal',       -- strong(しっかり) / normal(普通) / light(軽め)
  client_type      text not null default 'corporate',    -- corporate(法人) / individual(個人)
  updated_at       timestamptz not null default now()
);

-- RLS：public/anon からは触らせない（service_role はバイパス＝サーバーから読み書き可）。
alter table photo_report_settings enable row level security;
