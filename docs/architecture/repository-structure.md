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
│  │  ├─ report/photo/page.tsx ◇ 写真報告書（server=auth＋ロード→編集面島へ）
│  │  ├─ report/new/page.tsx   ※ 旧・汎用報告書プロトタイプ（日報/障害報告/改善提案）
│  │  ├─ api/
│  │  │  ├─ master/pests/route.ts      ◇ 害虫マスタ
│  │  │  ├─ master/chemicals/route.ts  ◇ 適用薬剤＋処理方法（カスケード）
│  │  │  ├─ case/route.ts              ◇ 施工予定IDでケース取得
│  │  │  ├─ folder/route.ts            ◇ Drive 画像一覧（画像プロキシ）
│  │  │  ├─ photo/route.ts             ◇ Drive 画像バイト（画像プロキシ）
│  │  │  ├─ photo-report/route.ts      ◇ 写真報告 プリフィルJSON（VM/再取得）
│  │  │  ├─ photo-report/save/route.ts ◇ 保存＝新版(Drive append-only)＋現在版(Supabase)差替
│  │  │  ├─ photo-report/versions/route.ts ◇ 版一覧（版名=description 含む）
│  │  │  ├─ photo-report/rollback/route.ts ◇ 旧版で新版を書く（監査）
│  │  │  ├─ photo-report/rename/route.ts   ◇ 版名（Drive description・本文不変）
│  │  │  ├─ photo-report/delete/route.ts   ◇ 版削除（Drive ゴミ箱・最新版不可）
│  │  │  ├─ case-digest/route.ts       ◇ 案件ダイジェスト「口」（_ai/ 書込み）
│  │  │  └─ reports/route.ts           ※ 旧・報告書保存（ローカルFS）
│  │  ├─ page.tsx / layout.tsx / globals.css
│  ├─ components/
│  │  ├─ photo-report-editor.tsx  ◇ 写真報告 編集面（見出し/所見/並び/保存=版/ロールバック・クライアント島）
│  │  ├─ photo-annotator.tsx      ◇ 注記レイヤー（透明SVG＋Pointer Events・正規化座標・UNDO/REDO）
│  │  ├─ print-button.tsx         PDF（印刷）ボタン
│  │  └─ report-form.tsx          ※ 旧・汎用フォーム
│  ├─ lib/
│  │  ├─ supabase-rest.ts      ◇ PostgRESTへのfetch（sbSelect/sbUpsert・SDK非依存・サーバー専用）
│  │  ├─ drive.ts              ◇ Drive 読み取り（画像プロキシ・readonly）
│  │  ├─ drive-write.ts        ◇ Drive 書込み（RW・_ai/口・版ファイル append-only）
│  │  ├─ photo-report-source.ts ◇ プリフィル合成＋現在版オーバーレイ
│  │  ├─ photo-report-store.ts ◇ 保存/版一覧/ロールバックのオーケストレーション
│  │  ├─ report-versions.ts    ◇ 版の純粋ロジック（版名 parse/format/next・自己記述ファイル）
│  │  ├─ case-digest.ts        ◇ ダイジェスト「口」定数/履歴追記
│  │  ├─ report-store.ts       ※ 旧・ローカルFS保存
│  │  └─ security/{launch-token,proxy-auth}.ts  起動トークン検証 / プロキシ認可（browser=token・VM=secret）
│  └─ schemas/
│     ├─ photo-report.ts       ◇ 写真報告 report JSON（fileId参照・annotations予約）
│     └─ report.ts             Zod スキーマ（launch context / 旧submission）
├─ worker/photo-report-worker.mjs  ◇ VM常駐 AIワーカー（Drive直読み→Claude Code→photo_reports）
├─ tests/                      schema / token / overlay / 版 / api-route のテスト
└─ docs/supabase/             スキーマ(report-app/slack-photo-report)・migrations・seed（README参照）
```

## 方針

- `app/mock` が現行の作業中心。旧 `report/new` 系（※）は汎用雛形で、本丸ではない。
- `lib/supabase-rest.ts` の Supabase アクセスは**サーバー（APIルート）専用**。service_role キーをクライアントに渡さない。
- 旧 `data/reports`（ローカルFS）は本番非永続。永続は Drive（＋Supabase）へ置換予定。

## 今後の追加（予定）

- `lib/justdb`（実同期・書き戻し。`open-issues.md` §0 の API 予算が解けてから）
- 本丸を `app/mock` から正式ルート（例 `app/report`）へ昇格
- 稼働後の契約抽出（画像プロキシ＋report JSON＋`_ai/` 書込み → `*_CONTRACT.md`・D-PORTS）

> 注：PDF はシステム非責務（人がブラウザから任意で印刷）＝`lib/pdf` は作らない。写真の赤丸注記は実装済（`components/photo-annotator.tsx`）。

詳細な役割分担は `architecture/overview.md`。
