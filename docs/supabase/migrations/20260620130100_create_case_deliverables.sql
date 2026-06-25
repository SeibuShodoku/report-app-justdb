-- 確定成果物マニフェスト（案件単位の時系列索引）。社内/顧客 共通レンダラの単一ソース。
-- 中身正本は Drive（_ai/reports/<folder_id>/v{version}.json ＋ 写真凍結 _ai/assets/<deliverable_id>/）。
-- 本表は「確定版を指す索引」（Drive から再生成可）。確定＝顧客可視の起点。
-- 仕様: docs/vision/case-portal.md §4.5 / docs/spec/prevention-report/ring1a-prevention-report.md D6
create table if not exists case_deliverables (
  deliverable_id    text primary key,               -- 確定単位の安定ID（例 "<folder_id>:v<version>"）
  case_id           text not null,
  report_type       text not null,                  -- 'photo' | 'prevention'（将来 estimate/invoice）
  stage             text,                           -- 'survey' | 'construction' | ...
  folder_id         text not null,                  -- 中身の版が住む Drive フォルダキー
  version           integer not null,               -- 確定した版番号（_ai/reports/.../v{version}.json）
  assets_path       text,                           -- 写真凍結先 _ai/assets/<deliverable_id>/（防除は null）
  title             text,
  customer_visible  boolean not null default false, -- 顧客面に出すか（確定＝可視の起点）
  confirmed_by      text,                           -- 確定者（IAP メール）
  confirmed_at      timestamptz not null default now()
);

-- 案件ごとに時系列で引く（社内/顧客 両レンダラの一覧クエリ）。
create index if not exists idx_case_deliverables_case on case_deliverables (case_id, confirmed_at);

-- RLS：public/anon からは触らせない（service_role はバイパス）。
alter table case_deliverables enable row level security;
