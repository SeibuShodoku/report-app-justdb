"use client";

/**
 * 写真報告書の編集面（クライアント島）。
 * - 見出し / 所見 / 並び / 全体要約を編集し、「保存」で **新版**（Drive append-only）＋現在版（Supabase）差替。
 * - 「版」から旧版へロールバック（旧版の内容で新版を書く＝監査）。
 * - annotations（赤丸など）は state に保持し保存時に送る（描画 UI は Step D）。
 * 認可は起動トークン（folderId 一致）。IAP が「誰か」を担保。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §5/§6
 */
import { useCallback, useState } from "react";
import { PhotoAnnotator } from "@/components/photo-annotator";
import { PrintButton } from "@/components/print-button";
import { BRANCH, DISCLAIMER } from "@/lib/report-template";
import type { PhotoReportView } from "@/lib/photo-report-source";
import type { Annotation } from "@/schemas/photo-report";
import {
  CLIENT_TYPE_LABEL,
  PROPOSAL_WEIGHT_LABEL,
  REPORT_TITLE,
  REPORT_TYPE_LABEL,
  RESPONSE_MODE_LABEL,
  TONE_POLITENESS_LABEL,
  type PhotoReportSettings
} from "@/schemas/photo-report-settings";

type EditItem = {
  fileId: string;
  name: string;
  mimeType: string;
  heading: string;
  annotationNote: string;
  annotations: Annotation[];
};

type VersionEntry = {
  version: number;
  fileId: string;
  modifiedTime?: string;
  label?: string;
  createdBy?: string;
};

type Props = {
  caseId: string;
  folderId: string;
  token: string;
  currentUserEmail?: string;
};

/** ブラウザが画像プロキシ経由で写真を取得する URL（pure・サーバーモジュール非依存）。 */
function photoUrl(fileId: string, folderId: string, token: string): string {
  const p = new URLSearchParams({ fileId, folderId, token });
  return `/api/photo?${p.toString()}`;
}

function toEditItems(view: PhotoReportView): EditItem[] {
  return view.photoItems.map((p) => ({
    fileId: p.fileId,
    name: p.name,
    mimeType: p.mimeType,
    heading: p.heading ?? "",
    annotationNote: p.annotationNote ?? "",
    annotations: p.annotations ?? []
  }));
}

export function PhotoReportEditor({
  initialView,
  initialSettings,
  caseId,
  folderId,
  token,
  currentUserEmail
}: Props & { initialView: PhotoReportView; initialSettings: PhotoReportSettings }) {
  const [items, setItems] = useState<EditItem[]>(() => toEditItems(initialView));
  const [coverFileId, setCoverFileId] = useState<string>(
    () => initialView.coverFileId ?? initialView.photoItems[0]?.fileId ?? ""
  );
  const [headerSummary, setHeaderSummary] = useState(initialView.headerSummary ?? "");
  const [workItemsText, setWorkItemsText] = useState((initialView.workItems ?? []).join("\n"));
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  // 設定（モーダル）
  const [settings, setSettings] = useState<PhotoReportSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const setField = useCallback(<K extends keyof PhotoReportSettings>(key: K, value: PhotoReportSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchItem = useCallback((index: number, patch: Partial<EditItem>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }, []);

  const move = useCallback((index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const buildReport = useCallback(
    () => ({
      caseId,
      driveFolderId: folderId,
      coverFileId: items.find((it) => it.fileId === coverFileId)?.fileId ?? items[0]?.fileId,
      headerSummary: headerSummary.trim() || undefined,
      workItems: workItemsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      photoItems: items.map((it) => ({
        fileId: it.fileId,
        heading: it.heading.trim() || undefined,
        annotationNote: it.annotationNote.trim() || undefined,
        annotations: it.annotations
      }))
    }),
    [caseId, folderId, coverFileId, headerSummary, workItemsText, items]
  );

  const saveSettings = useCallback(async () => {
    setSettingsSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/photo-report/settings?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `設定の保存に失敗（${res.status}）`);
      setSettingsOpen(false);
      setMessage({ type: "success", text: "設定を保存しました。「AIで再作成」で反映できます。" });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "設定の保存に失敗しました。" });
    } finally {
      setSettingsSaving(false);
    }
  }, [folderId, token, settings]);

  const generate = useCallback(async () => {
    if (!window.confirm("現在の設定で AI に報告書を作り直させます（現在版は上書きされます）。よろしいですか？")) {
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/photo-report/generate?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `生成依頼に失敗（${res.status}）`);
      setMessage({
        type: "success",
        text: "AI生成を依頼しました。1〜数分で完成します。少し待ってからページを再読み込みしてください。"
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "生成依頼に失敗しました。" });
    } finally {
      setGenerating(false);
    }
  }, [folderId, token]);

  const refreshVersions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/photo-report/versions?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `版一覧の取得に失敗（${res.status}）`);
      setVersions(json.versions ?? []);
    } catch (e) {
      setVersions([]);
      setMessage({ type: "error", text: e instanceof Error ? e.message : "版一覧の取得に失敗しました。" });
    }
  }, [folderId, token]);

  const toggleVersions = useCallback(() => {
    const open = !versionsOpen;
    setVersionsOpen(open);
    // 開くたびに取り直す（保存後に増えた版を反映する。一度空で取得したらキャッシュされる不具合の修正）。
    if (open) {
      setVersions(null);
      void refreshVersions();
    }
  }, [versionsOpen, refreshVersions]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/photo-report/save?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report: buildReport(), label: saveLabel.trim() || undefined })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `保存に失敗（${res.status}）`);
      setMessage({
        type: "success",
        text: `保存しました（v${json.version}${saveLabel.trim() ? `「${saveLabel.trim()}」` : ""}）。`
      });
      setSaveLabel("");
      if (versionsOpen) void refreshVersions();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "保存に失敗しました。" });
    } finally {
      setSaving(false);
    }
  }, [folderId, token, buildReport, saveLabel, versionsOpen, refreshVersions]);

  const renameVersion = useCallback(
    async (version: number, current: string) => {
      const label = window.prompt(`v${version} の版名`, current);
      if (label === null) return; // キャンセル
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/photo-report/rename?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version, label })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `版名の更新に失敗（${res.status}）`);
        await refreshVersions();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "版名の更新に失敗しました。" });
      } finally {
        setBusyVersion(null);
      }
    },
    [folderId, token, refreshVersions]
  );

  const deleteVersion = useCallback(
    async (version: number) => {
      if (!window.confirm(`v${version} を削除します（Drive のゴミ箱へ移動・復元可）。よろしいですか？`)) {
        return;
      }
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/photo-report/delete?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `削除に失敗（${res.status}）`);
        await refreshVersions();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "削除に失敗しました。" });
      } finally {
        setBusyVersion(null);
      }
    },
    [folderId, token, refreshVersions]
  );

  const rollback = useCallback(
    async (version: number) => {
      if (!window.confirm(`v${version} の内容で新しい版を作成して現在版に戻します。よろしいですか？`)) {
        return;
      }
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/photo-report/rollback?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `ロールバックに失敗（${res.status}）`);
        // 現在版が入れ替わったので、サーバー再描画で最新を反映する。
        window.location.reload();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "ロールバックに失敗しました。" });
        setBusyVersion(null);
      }
    },
    [folderId, token]
  );

  // 印刷（PDF）用の派生値（設定メタ＋編集中の内容）。
  const title = REPORT_TITLE[settings.reportType];
  const kindLabel = settings.reportType === "survey" ? "調査" : "施工";
  const propertyName = (settings.propertyName ?? "").trim();
  const propertyLabel = propertyName ? (/様$/.test(propertyName) ? propertyName : `${propertyName} 様`) : "";
  const execDate = (settings.execDate ?? "").trim();
  const reporter = (settings.reporter ?? "").trim();
  const workItemsList = workItemsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const coverItem = items.find((it) => it.fileId === coverFileId) ?? items[0];

  // 印刷レイアウト＝テンプレート grid-8（縦4×横2＝8枚/A4ページ）。
  // 写真を 8 枚ずつのページに分割し、各ページを A4 固定で描く（画面準拠をやめ環境非依存に）。
  // 将来テンプレート（例 detail-3）を足すときは PHOTOS_PER_PAGE とクラスを切り替える。
  const PHOTOS_PER_PAGE = 8;
  const photoPages: EditItem[][] = [];
  for (let i = 0; i < items.length; i += PHOTOS_PER_PAGE) {
    photoPages.push(items.slice(i, i + PHOTOS_PER_PAGE));
  }

  return (
    <section className="panel">
      <div className="inline-actions no-print">
        <h1>写真報告書</h1>
        <input
          type="text"
          className="version-label-input"
          value={saveLabel}
          maxLength={200}
          placeholder="版名（任意）"
          onChange={(e) => setSaveLabel(e.target.value)}
        />
        <button type="button" onClick={save} disabled={saving || items.length === 0}>
          {saving ? "保存中…" : "保存（新しい版）"}
        </button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          ⚙️ 設定
        </button>
        <button type="button" onClick={generate} disabled={generating}>
          {generating ? "依頼中…" : "AIで再作成"}
        </button>
        <button type="button" onClick={toggleVersions}>
          {versionsOpen ? "版を閉じる" : "版を表示"}
        </button>
        <PrintButton />
      </div>

      {settingsOpen ? (
        <div className="modal-backdrop no-print" onClick={() => setSettingsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inline-actions">
              <h2>報告書の設定</h2>
            </div>
            <p className="notice">種類・実施日・物件名・担当者と、AI 文章のトーンを設定します。「AIで再作成」で反映されます。</p>

            <div className="editor-field">
              <label htmlFor="set-type">報告書の種類</label>
              <select
                id="set-type"
                value={settings.reportType}
                onChange={(e) => setField("reportType", e.target.value as PhotoReportSettings["reportType"])}
              >
                {Object.entries(REPORT_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}（{REPORT_TITLE[v as PhotoReportSettings["reportType"]]}）</option>
                ))}
              </select>
            </div>

            <div className="editor-field">
              <label htmlFor="set-date">実施日（手入力）</label>
              <input
                id="set-date"
                type="text"
                value={settings.execDate ?? ""}
                maxLength={40}
                placeholder="例: 2026年6月19日"
                onChange={(e) => setField("execDate", e.target.value)}
              />
            </div>

            <div className="editor-field">
              <label htmlFor="set-property">物件名（施工現場）</label>
              <input
                id="set-property"
                type="text"
                value={settings.propertyName ?? ""}
                maxLength={120}
                placeholder="例: 齋藤マンション様"
                onChange={(e) => setField("propertyName", e.target.value)}
              />
            </div>

            <div className="editor-field">
              <label htmlFor="set-reporter">担当者</label>
              <input
                id="set-reporter"
                type="text"
                value={settings.reporter ?? ""}
                maxLength={80}
                placeholder="例: 紺谷直人"
                onChange={(e) => setField("reporter", e.target.value)}
              />
            </div>

            <div className="editor-field">
              <label htmlFor="set-tone">文体</label>
              <select
                id="set-tone"
                value={settings.tonePoliteness}
                onChange={(e) => setField("tonePoliteness", e.target.value as PhotoReportSettings["tonePoliteness"])}
              >
                {Object.entries(TONE_POLITENESS_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>

            <div className="editor-field">
              <label htmlFor="set-response">対応の性質</label>
              <select
                id="set-response"
                value={settings.responseMode}
                onChange={(e) => setField("responseMode", e.target.value as PhotoReportSettings["responseMode"])}
              >
                {Object.entries(RESPONSE_MODE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>

            <div className="editor-field">
              <label htmlFor="set-proposal">提案の重さ</label>
              <select
                id="set-proposal"
                value={settings.proposalWeight}
                onChange={(e) => setField("proposalWeight", e.target.value as PhotoReportSettings["proposalWeight"])}
              >
                {Object.entries(PROPOSAL_WEIGHT_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>

            <div className="editor-field">
              <label htmlFor="set-client">相手</label>
              <select
                id="set-client"
                value={settings.clientType}
                onChange={(e) => setField("clientType", e.target.value as PhotoReportSettings["clientType"])}
              >
                {Object.entries(CLIENT_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>

            <div className="inline-actions">
              <button type="button" onClick={saveSettings} disabled={settingsSaving}>
                {settingsSaving ? "保存中…" : "設定を保存"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="no-print">案件ID: {caseId}</p>
      <p className="no-print">写真 {items.length} 枚</p>

      {message ? (
        <p className={`notice ${message.type} no-print`} role="status">
          {message.text}
        </p>
      ) : null}

      {/* ===== 印刷(PDF) 表紙 ===== */}
      <div className="print-only print-cover">
        <h1 className="cover-title">{title}</h1>
        {coverItem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="cover-photo" src={photoUrl(coverItem.fileId, folderId, token)} alt="表紙写真" />
        ) : null}
        <table className="cover-table">
          <tbody>
            <tr>
              <th>{kindLabel}実施日</th>
              <td>{execDate || "　"}</td>
            </tr>
            <tr>
              <th>{kindLabel}現場</th>
              <td>{propertyLabel || "　"}</td>
            </tr>
          </tbody>
        </table>
        <div className="cover-company">
          <div className="cover-company-name">{BRANCH.company}</div>
          <div>
            {BRANCH.company} {BRANCH.branch}
          </div>
          <div>{BRANCH.postal}</div>
          <div>{BRANCH.tel}</div>
          {reporter ? <div>担当者: {reporter}</div> : null}
          <div>{BRANCH.url}</div>
        </div>
      </div>

      {versionsOpen ? (
        <div className="section-block no-print">
          <label>版履歴（新しい順）</label>
          {versions === null ? (
            <p className="notice">読み込み中…</p>
          ) : versions.length === 0 ? (
            <p className="notice">まだ保存された版はありません（保存すると v0001 から記録されます）。</p>
          ) : (
            <ul className="version-list">
              {versions.map((v, vi) => {
                const isLatest = vi === 0; // 降順なので先頭＝最新＝現在版
                // 作成者が記録されていて、かつ本人でなければ削除不可（旧版＝未記録は許容）。
                const notOwner = Boolean(
                  v.createdBy && currentUserEmail && v.createdBy !== currentUserEmail
                );
                const deleteDisabled = busyVersion !== null || isLatest || notOwner;
                const deleteTitle = isLatest
                  ? "最新版（現在版）は削除できません。先に別版へ戻してください。"
                  : notOwner
                    ? `作成者（${v.createdBy}）のみ削除できます。`
                    : "Drive のゴミ箱へ（復元可）";
                return (
                  <li key={v.version}>
                    <span>
                      v{v.version}
                      {isLatest ? "（現在版）" : ""}
                      {v.label ? `・${v.label}` : ""}
                      {v.createdBy ? `・${v.createdBy}` : ""}
                      {v.modifiedTime ? `・${new Date(v.modifiedTime).toLocaleString("ja-JP")}` : ""}
                    </span>
                    <span className="version-actions">
                      <button
                        type="button"
                        onClick={() => renameVersion(v.version, v.label ?? "")}
                        disabled={busyVersion !== null}
                      >
                        名前
                      </button>
                      <button
                        type="button"
                        onClick={() => rollback(v.version)}
                        disabled={busyVersion !== null}
                      >
                        {busyVersion === v.version ? "処理中…" : "この版に戻す"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteVersion(v.version)}
                        disabled={deleteDisabled}
                        title={deleteTitle}
                      >
                        削除
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <div className="editor-field no-print">
        <label htmlFor="headerSummary">{kindLabel}概要（まとめ文章）</label>
        <textarea
          id="headerSummary"
          value={headerSummary}
          maxLength={2000}
          placeholder="現場全体のまとめ（任意）"
          onChange={(e) => setHeaderSummary(e.target.value)}
        />
      </div>

      <div className="editor-field no-print">
        <label htmlFor="workItems">{kindLabel}内容（1行に1項目）</label>
        <textarea
          id="workItems"
          value={workItemsText}
          maxLength={3000}
          placeholder={"例:\n101号室、102号室及び103号室の床下に木部剤及び土壌剤を散布処理\n101号室、102号室及び103号室の風呂場の壁面を穿孔し薬剤を注入処理"}
          onChange={(e) => setWorkItemsText(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <p className="notice">このフォルダに写真がありません。</p>
      ) : (
        <div className="photo-grid tmpl-grid-8">
          {photoPages.map((pageItems, pageIndex) => (
            <div className="photo-page" key={pageIndex}>
              {pageItems.map((item, j) => {
                const index = pageIndex * PHOTOS_PER_PAGE + j;
                const isCover = item.fileId === coverFileId;
                return (
                  <figure key={item.fileId} className="photo-card">
                    <div className="print-only print-caption">
                      {index + 1}．{item.heading || `写真 ${index + 1}`}
                    </div>
                    <PhotoAnnotator
                      src={photoUrl(item.fileId, folderId, token)}
                      alt={item.heading || item.name}
                      value={item.annotations}
                      onChange={(next) => patchItem(index, { annotations: next })}
                    />
                    <div className="slot-buttons no-print">
                      <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>
                        ↑ 前へ
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === items.length - 1}
                      >
                        ↓ 後へ
                      </button>
                    </div>
                    <figcaption className="editor-field no-print">
                      <button
                        type="button"
                        className={isCover ? "" : "btn-secondary"}
                        onClick={() => setCoverFileId(item.fileId)}
                        disabled={isCover}
                        title="この写真を表紙にします"
                      >
                        {isCover ? "★ 表紙（この写真）" : "☆ 表紙にする"}
                      </button>
                      <label htmlFor={`h-${item.fileId}`}>見出し（写真 {index + 1}）</label>
                      <input
                        id={`h-${item.fileId}`}
                        type="text"
                        value={item.heading}
                        maxLength={80}
                        placeholder={`写真 ${index + 1}`}
                        onChange={(e) => patchItem(index, { heading: e.target.value })}
                      />
                      <label htmlFor={`n-${item.fileId}`}>所見</label>
                      <textarea
                        id={`n-${item.fileId}`}
                        value={item.annotationNote}
                        maxLength={500}
                        placeholder="所見（任意）"
                        onChange={(e) => patchItem(index, { annotationNote: e.target.value })}
                      />
                      {item.annotations.length > 0 ? (
                        <p className="notice no-print">注記 {item.annotations.length} 件（保存に含まれます）</p>
                      ) : null}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ===== 印刷(PDF) 最終ページ：概要／内容／免責 ===== */}
      <div className="print-only print-summary">
        <div className="summary-head">
          <span className="summary-property">{propertyLabel}</span>
          <span className="summary-date">実施日　{execDate}</span>
        </div>
        <section className="summary-box">
          <h3>{kindLabel}概要</h3>
          <p className="summary-text">{headerSummary || "　"}</p>
        </section>
        <section className="summary-box">
          <h3>{kindLabel}内容</h3>
          {workItemsList.length > 0 ? (
            <ol className="summary-items">
              {workItemsList.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ol>
          ) : (
            <p className="summary-text">　</p>
          )}
        </section>
        <section className="summary-box">
          <h3>免責事項</h3>
          <div className="summary-disclaimer">
            {DISCLAIMER.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </section>
        <div className="summary-end">以上</div>
      </div>
    </section>
  );
}
