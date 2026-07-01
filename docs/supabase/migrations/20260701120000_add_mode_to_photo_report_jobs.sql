-- 写真報告ジョブに「生成モード」を追加する。
--   full    = 従来どおり写真＋文脈から全体を生成（既定）
--   summary = 見出し＋設定＋文脈だけから「概要(headerSummary)・内容(workItems)」のみ生成＝写真を読まず軽量
-- 既存行は full 扱い。folder 単位の1行（Slack/Webが収束）に対し、依頼のたびに mode を上書きする。
-- 適用: Supabase の SQL エディタで実行（service_role 前提・RLSはバイパス）。
alter table photo_report_jobs add column if not exists mode text not null default 'full';
