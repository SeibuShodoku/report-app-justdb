# Supabase マイグレーション

写真報告 Supabase プロジェクト（ref = `hnqmokrbgxxahmtoeryx`）への差分適用 SQL。

- **命名**: `YYYYMMDDHHMMSS_説明.sql`（Supabase CLI 互換。将来 `supabase db push` でも使える）。
- **適用**: 現状は CLI 未使用 → **Supabase ダッシュボード → SQL Editor** に古い順で貼り付けて実行。
- **方針**: 各ファイルは**冪等**（`if not exists` 等）にし、再実行しても安全に。
- ベースライン（現行の全体スキーマ）は親ディレクトリの `../report-app-schema.sql` / `../slack-photo-report-schema.sql`。本ディレクトリはそれ以降の差分。全体像は `../README.md`。

| ファイル | 内容 |
|---|---|
| `20260619170500_add_notified_at_to_photo_report_jobs.sql` | 3c 完了返信用に `photo_report_jobs.notified_at` を追加 |
