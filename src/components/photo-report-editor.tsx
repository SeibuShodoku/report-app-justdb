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
import type { PhotoReportView } from "@/lib/photo-report-source";
import type { Annotation } from "@/schemas/photo-report";

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
  caseId,
  folderId,
  token,
  currentUserEmail
}: Props & { initialView: PhotoReportView }) {
  const [items, setItems] = useState<EditItem[]>(() => toEditItems(initialView));
  const [headerSummary, setHeaderSummary] = useState(initialView.headerSummary ?? "");
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);

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
      headerSummary: headerSummary.trim() || undefined,
      photoItems: items.map((it) => ({
        fileId: it.fileId,
        heading: it.heading.trim() || undefined,
        annotationNote: it.annotationNote.trim() || undefined,
        annotations: it.annotations
      }))
    }),
    [caseId, folderId, headerSummary, items]
  );

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
        <button type="button" onClick={toggleVersions}>
          {versionsOpen ? "版を閉じる" : "版を表示"}
        </button>
        <PrintButton />
      </div>

      <p>案件ID: {caseId}</p>
      <p>写真 {items.length} 枚</p>

      {message ? (
        <p className={`notice ${message.type}`} role="status">
          {message.text}
        </p>
      ) : null}

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

      <div className="editor-field">
        <label htmlFor="headerSummary">全体要約</label>
        <textarea
          id="headerSummary"
          value={headerSummary}
          maxLength={2000}
          placeholder="現場全体のまとめ（任意）"
          onChange={(e) => setHeaderSummary(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <p className="notice">このフォルダに写真がありません。</p>
      ) : (
        <div className="photo-grid">
          {items.map((item, index) => (
            <figure key={item.fileId} className="photo-card">
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
              <figcaption className="editor-field">
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
          ))}
        </div>
      )}
    </section>
  );
}
