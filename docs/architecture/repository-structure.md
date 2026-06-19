# リポジトリ構成（v1.0・現況）

実装と仕様の責務を分け、変更影響を局所化する。以下は**現況**（◇=現行作業の中心、※=旧プロトタイプ）。

```text
.
├─ docs/                       仕様・設計（spec / architecture / runbook / reference / archive / supabase）
├─ public/
│  └─ seibu-joto-logo.jpg      城東支店ロゴ（原本Excelから抽出）
├─ scripts/
│  └─ generate-launch-token.mjs  起動トークン生成
├─ src/
│  ├─ app/
│  │  ├─ mock/page.tsx         ◇ 防除作業報告書モック（紺谷V/写真/融合・カスケード・ケース取得）
│  │  ├─ report/new/page.tsx   ※ 旧・汎用報告書プロトタイプ（日報/障害報告/改善提案）
│  │  ├─ api/
│  │  │  ├─ master/pests/route.ts      ◇ 害虫マスタ
│  │  │  ├─ master/chemicals/route.ts  ◇ 適用薬剤＋処理方法（カスケード）
│  │  │  ├─ case/route.ts              ◇ 施工予定IDでケース取得
│  │  │  └─ reports/route.ts           ※ 旧・報告書保存（ローカルFS）
│  │  ├─ page.tsx / layout.tsx / globals.css
│  ├─ components/report-form.tsx  ※ 旧・汎用フォーム
│  ├─ lib/
│  │  ├─ supabase-rest.ts      ◇ PostgRESTへのfetch（SDK非依存・サーバー専用）
│  │  ├─ report-store.ts       ※ 旧・ローカルFS保存
│  │  └─ security/launch-token.ts  起動トークン検証
│  └─ schemas/report.ts        Zod スキーマ（launch context / 旧submission）
├─ tests/                      schema / token / api-route のテスト
└─ docs/supabase/             スキーマ(report-app/slack-photo-report)・migrations・seed（README参照）
```

## 方針

- `app/mock` が現行の作業中心。旧 `report/new` 系（※）は汎用雛形で、本丸ではない。
- `lib/supabase-rest.ts` の Supabase アクセスは**サーバー（APIルート）専用**。service_role キーをクライアントに渡さない。
- 旧 `data/reports`（ローカルFS）は本番非永続。永続は Drive（＋Supabase）へ置換予定。

## 今後の追加（予定）

- `lib/drive`（Drive保管: PDF＋再編集JSON）／`lib/pdf`（サーバーPDF生成）
- `lib/justdb`（実同期・書き戻し）／写真の赤丸注記コンポーネント
- 本丸を `app/mock` から正式ルート（例 `app/report`）へ昇格

詳細な役割分担は `architecture/overview.md`。
