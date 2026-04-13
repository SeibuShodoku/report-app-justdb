# リポジトリ構成方針（v0.2）

## 1. 目的

実装と仕様の責務を分け、変更影響を局所化する。

## 2. 推奨構成

```text
.
├─ docs/
│  ├─ spec/
│  └─ architecture/
├─ scripts/
├─ src/
│  ├─ app/
│  │  ├─ report/
│  │  └─ api/
│  ├─ components/
│  ├─ features/
│  │  ├─ report-editor/
│  │  ├─ image-annotation/
│  │  └─ pdf-export/
│  ├─ lib/
│  │  ├─ report-store/
│  │  ├─ pdf/
│  │  └─ security/
│  ├─ schemas/
│  └─ types/
├─ tests/
└─ data/
   └─ reports/
```

## 3. 分割方針

- `features/`: 業務機能単位のUI・ユースケース
- `lib/report-store.ts`: 報告書保存
- `lib/security`: URLトークン検証
- `lib/pdf`: 帳票生成
- `schemas/`: Zod等の入出力スキーマ
- `data/reports`: ローカル保存領域（本番ではDB/ストレージへ置換予定）

## 4. 実装順序（推奨）

1. URLパラメータ検証とトークン検証
2. 報告書編集機能
3. 画像注記機能
4. サーバーPDF生成
5. 監査ログ
