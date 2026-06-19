# Supabase（スキーマ / マイグレーション / シード）

写真報告 Supabase プロジェクト（ref = `hnqmokrbgxxahmtoeryx`）。本リポは Supabase CLI 未使用＝**ダッシュボード SQL Editor 貼り付け運用**。役割を分離して管理する。

## レイアウト

| 種別 | ファイル | 内容 |
|---|---|---|
| スキーマ（現行・全体像） | `report-app-schema.sql` | report-app 本体: `pests` / `chemicals` / `construction_schedules` |
| スキーマ（現行・全体像） | `slack-photo-report-schema.sql` | Slack写真報告: `photo_report_jobs` / `photo_reports`（RLS有） |
| 差分 | `migrations/*.sql` | スキーマ確定“以降”の差分。CLI互換命名・冪等・**古い順**に適用（[migrations/README](./migrations/README.md)） |
| シード | `seed.sql` | 開発/デモデータ（本番の `chemicals` は JUST.DB 同期が正本） |

## 適用順（新規セットアップ）

1. `report-app-schema.sql`
2. `slack-photo-report-schema.sql`
3. `migrations/` を古い順に
4. `seed.sql`（開発時のみ）

## 方針

- **schema = 現行の全体像**（`create table if not exists` 等で冪等）。
- **migrations = schema 確定以降の差分**（`alter … if not exists` 等で冪等・CLI互換命名で将来 `supabase db push` も可）。
- **seed = データ**（`on conflict` で冪等）。schema には混ぜない。
- すべて再実行して安全。
