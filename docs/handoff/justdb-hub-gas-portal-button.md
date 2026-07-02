# 改修依頼書：justdb-hub-gas ― 案件トピックに「案件ポータル」導線を追加

- 宛先リポジトリ：`justdb-hub-gas`（＋複製先 `topic-digest-gas`）
- 依頼元：`report-app-justdb`（案件ポータル `/portal` 実体化・rev `report-app-justdb-00060-fnv`）
- 作成日：2026-07-02
- 種別：小変更（Slack ブロック1つにボタン追加＋空ACK分岐1行）
- デプロイ：**本人**（`clasp deploy`。CI等では触らない）

---

## 1. 目的・背景

report-app 側に **案件ポータル `/portal?caseId=…`（総合窓口・IAP社内）** を本番投入済み。
案件にぶら下がる成果物（写真報告書 / 防除作業報告書 / 見積 / 確定済）を1画面に集約し、各編集面へ
deep-link する。Slack の案件トピックの入口を、将来的に「総合窓口への固定リンク」へ寄せていく第一歩。

**設計の芯（ここだけ押さえれば実装は素直）**：
ポータルURLは **IAP が門**なので `caseId` は単なるセレクタ＝**launch token 不要**。
`/report/*` のような HMAC 署名付きURLではなく、**素の固定リンク** `…/portal?caseId=<案件ID>` でよい。
（総当り耐性は IAP 側にある。＝`/report/*` の「token＝フォルダ許可」契約は今回いじらない。）

---

## 2. 重要な前提 ― 今回は「置き換え」ではなく「追加」

- 現行の「📋 報告書」ボタン（`pr_menu` → `pr_start` → `pr_create`）は
  **写真フォルダ（写真_YYYYMMDD）の作成 ＋ 生成ジョブ投入という “作成” の入口**。
- 案件ポータルは現状 **既存成果物のナビゲーションのみ**（新規フォルダ作成・ジョブ投入はまだ持たない）。
- したがって **既存の「報告書」ボタンは残したまま、ポータル導線を1つ “追加” する**のが安全
  （作成経路を壊さない）。Slack 1ボタン化（完全統合）は、ポータルが作成を担えるようになってから
  （§8 Step2・将来）。

---

## 3. 対象ファイル

| ファイル | 箇所 | 変更 |
|---|---|---|
| `SlackMessageRouting.gs` | 案件トピック初回投稿の `type:'actions'` ブロック（現状 L148–157） | ポータルURLボタンを追加 |
| `topic-digest-gas` `topicBlocks.gs` | 上記の**複製**（コード内コメント「複製: topic-digest/topicBlocks.gs と同期」） | **同じ変更を必ず同期** |
| `photo_report_actions.gs` | ルータ（`pr_*` 分岐）＋（任意）URLヘルパ | 空ACK分岐を1行／ヘルパ追加 |

---

## 4. 変更内容（Step 1：ポータル導線を追加）

### 4-1. URLヘルパ（任意・DRY）
`photo_report_actions.gs` にベースURL/ポータルURLの小ヘルパを追加（既存2箇所のベースURL直書きもここへ寄せてよい）：

```javascript
/** report-app のベースURL（Script Property REPORT_APP_URL・既定は本番）。 */
function pr_appBaseUrl_() {
  return PropertiesService.getScriptProperties().getProperty('REPORT_APP_URL') ||
    'https://report-app-justdb-137338258930.asia-northeast1.run.app';
}

/** 案件ポータルの固定リンク（IAPが門＝token不要・caseIdはセレクタ）。 */
function pr_portalUrl_(caseId) {
  return pr_appBaseUrl_() + '/portal?caseId=' + encodeURIComponent(String(caseId || ''));
}
```

### 4-2. 案件トピックのボタン（`SlackMessageRouting.gs`）

**現状：**
```javascript
{
  type: 'actions',
  elements: [
    {
      type: 'button',
      action_id: 'pr_menu',
      text: { type: 'plain_text', text: '📋 報告書' },
      value: JSON.stringify({ caseId: projectId || '', driveFolderUrl: googleDriveFolderUrl || '' }),
    }
  ]
},
```

**変更後（ポータルURLボタンを先頭に“追加”。`pr_menu` はそのまま残す）：**
```javascript
{
  type: 'actions',
  elements: [
    {
      type: 'button',
      action_id: 'pr_open_portal',       // URLボタンでも block_actions は飛ぶので action_id を付ける
      text: { type: 'plain_text', text: '🗂 案件ポータル' },
      url: pr_portalUrl_(projectId),      // ← 固定リンク・token不要
      value: JSON.stringify({ caseId: projectId || '' }),
    },
    {
      type: 'button',
      action_id: 'pr_menu',
      text: { type: 'plain_text', text: '📋 報告書' },
      value: JSON.stringify({ caseId: projectId || '', driveFolderUrl: googleDriveFolderUrl || '' }),
    }
  ]
},
```

- URLボタンは Slack が **URL をブラウザで開く**（今の報告書リンクを開くのと同じ経路＝IAP / Google SSO で `/portal` に着く）。
- `topic-digest-gas/topicBlocks.gs` の複製にも **同じ2要素**を入れる（`projectId` に相当する変数名は複製側に合わせる）。

### 4-3. 空ACK分岐（`photo_report_actions.gs`）

URLボタンでも block_actions ペイロードは飛ぶため、**200 空ACK**が要る。`pr_open_portal` は `pr_` 接頭なので
既存ルータ（`if (actionId === 'pr_open') …` の並び）に「何もせず ack」する分岐を1行足す：

```javascript
if (actionId === 'pr_open_portal') return { text: '' }; // URLボタン＝ブラウザで開くだけ。空ackのみ。
```

（返り値の作法は既存ハンドラに合わせる。security_proxy が `pr_*` をこのルータへ委譲している前提。）

---

## 5. Script Property 前提

- `REPORT_APP_URL`：未設定でも既定（本番URL）で動く。設定済みならそれを使う。
- **ポータル導線は `REPORT_LINK_SECRET` を使わない**（token 不要）。既存の `/report/*` 発行では引き続き必要なので、削除・変更はしない。

---

## 6. デプロイ手順（本人）

1. `justdb-hub-gas`：`clasp push` → `clasp deploy -i @<版>`（**push だけでは `/exec` に反映されない**）。
2. `topic-digest-gas`：同様に `clasp push` → `clasp deploy -i @<版>`。

---

## 7. 検証

1. 既存案件のトピックで **「🗂 案件ポータル」** を押す → ブラウザで `…/portal?caseId=<案件ID>` が開き、
   その案件の成果物（写真報告書等）が一覧され、各行から編集面へ入れる。
2. クリック後に Slack がエラー表示を出さない（空ACKが効いている）。
3. **「📋 報告書」（作成フロー）が従来どおり**動く（回帰なし＝写真フォルダ作成→ジョブ投入→完了通知）。
4. `topic-digest` 経由の投稿でも同じ2ボタンが出る（複製同期の確認）。

---

## 8. 将来（Step 2・今回の対象外）

- ポータルが「新規作成」を担えるようになったら（その日フォルダ find-or-create ＋ アプリ内アップローダ
  ＋ 4種の案件メニュー）、**2ボタンを「📋 報告・見積」1本に統合**し、`pr_menu`/`pr_start` を Slack から退役。
- 参照：report-app `docs/vision/case-portal.md §7.5`（案件ポータル phase2 の設計記録）、
  `docs/spec/photo-report/case-portal-flow.md`。
