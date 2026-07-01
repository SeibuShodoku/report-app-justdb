"use client";

/**
 * 写真報告書の編集面（クライアント島）。
 * - 見出し / 所見 / 並び / 全体要約を編集し、「保存」で **新版**（Drive append-only）＋現在版（Supabase）差替。
 * - 「版」から旧版へロールバック（旧版の内容で新版を書く＝監査）。
 * - annotations（赤丸など）は state に保持し保存時に送る（描画 UI は Step D）。
 * 認可は起動トークン（folderId 一致）。IAP が「誰か」を担保。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §5/§6
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoAnnotator } from "@/components/photo-annotator";
import { PhotoReorderModal } from "@/components/photo-reorder-modal";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
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
  excluded: boolean; // 報告書に「載せない」＝PDF/AIから外す（Drive には残す・載せ直し可）
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
  hasReport?: boolean; // 保存済み報告書があるか（AIボタンの文言＝作成/再作成の判定）
};

/** ISO日付(YYYY-MM-DD)を「YYYY年M月D日」に整形。ISOでなければそのまま返す（旧・手入力の互換）。 */
function formatJpDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : s;
}

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
    annotations: p.annotations ?? [],
    excluded: p.excluded ?? false
  }));
}

export function PhotoReportEditor({
  initialView,
  initialSettings,
  caseId,
  folderId,
  token,
  currentUserEmail,
  hasReport
}: Props & { initialView: PhotoReportView; initialSettings: PhotoReportSettings }) {
  const [items, setItems] = useState<EditItem[]>(() => toEditItems(initialView));
  const [coverFileId, setCoverFileId] = useState<string>(
    () => initialView.coverFileId ?? initialView.photoItems[0]?.fileId ?? ""
  );
  const [headerSummary, setHeaderSummary] = useState(initialView.headerSummary ?? "");
  const [workItemsText, setWorkItemsText] = useState((initialView.workItems ?? []).join("\n"));
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
  const [genPolling, setGenPolling] = useState(false); // AI再作成の完了待ち（ポーリング）
  const [summaryGenerating, setSummaryGenerating] = useState(false); // まとめだけAI 依頼中
  const [summaryPolling, setSummaryPolling] = useState(false); // まとめだけAI 完了待ち
  const [pdfSaving, setPdfSaving] = useState(false); // PDFをDriveへ保存中
  const [coverPickerOpen, setCoverPickerOpen] = useState(false); // 表紙選択モーダル
  const [reorderOpen, setReorderOpen] = useState(false); // 並べ替えモーダル
  const [photosOpen, setPhotosOpen] = useState(false); // 「写真」＝除外中の写真を報告書に戻す画面
  // まとめ文章の別窓編集（インラインだと狭くて見づらいため、タップで広いモーダルで編集）
  const [summaryEdit, setSummaryEdit] = useState<null | "headerSummary" | "workItems">(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  // 保存済み報告書の有無（AIボタン文言＝作成/再作成）。保存/生成依頼で true に倒す（リロードを待たず更新）。
  const [reportExists, setReportExists] = useState<boolean>(hasReport ?? false);

  // モーダル表示中は背景(編集画面)のスクロール/プル更新を凍結。並べ替えは自前で凍結するため除く。
  useBodyScrollLock(settingsOpen || versionsOpen || coverPickerOpen || photosOpen || summaryEdit !== null);

  // まとめ文章を別窓で開く／閉じる（閉じる時に下書きを反映＝手戻りしない）。
  // onFocus ではなく onClick で開く（フォーカス復帰で無限に開き直す不具合を避ける）。
  const openSummary = useCallback(
    (field: "headerSummary" | "workItems") => {
      if (summaryGenerating || summaryPolling) return; // AI生成中はロック（編集させない）
      setSummaryDraft(field === "headerSummary" ? headerSummary : workItemsText);
      setSummaryEdit(field);
    },
    [headerSummary, workItemsText, summaryGenerating, summaryPolling]
  );
  const closeSummary = useCallback(() => {
    setSummaryEdit((field) => {
      if (field === "headerSummary") setHeaderSummary(summaryDraft);
      else if (field === "workItems") setWorkItemsText(summaryDraft);
      return null;
    });
  }, [summaryDraft]);

  const setField = useCallback(<K extends keyof PhotoReportSettings>(key: K, value: PhotoReportSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // fileId で1枚を更新する（除外で表示リストが間引かれてもズレない＝index 依存を避ける）。
  const patchItemById = useCallback((fileId: string, patch: Partial<EditItem>) => {
    setItems((prev) => prev.map((it) => (it.fileId === fileId ? { ...it, ...patch } : it)));
  }, []);

  // 並べ替えモーダルの結果（fileId の新しい並び）を items に反映する。
  const reorderByFileIds = useCallback((orderedIds: string[]) => {
    setItems((prev) => {
      const map = new Map(prev.map((it) => [it.fileId, it]));
      const next = orderedIds.map((id) => map.get(id)).filter((it): it is EditItem => Boolean(it));
      // 万一漏れた写真があれば末尾に温存（取りこぼし防止）。
      for (const it of prev) if (!orderedIds.includes(it.fileId)) next.push(it);
      return next.length === prev.length ? next : prev;
    });
  }, []);

  // 写真アップロード（案件ポータル動線フェーズ1）：その日の写真フォルダへ直接入れ、
  // 結果を items に追記する（リロードしない＝編集中の見出し等を失わない）。
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadPhotos = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      setUploading(true);
      setMessage(null);
      let ok = 0;
      try {
        // 1枚ずつ送る：複数を1リクエストにまとめると Cloud Run の最大リクエストサイズ(32MB)を
        // 超え、プラットフォームが HTML(413等) を返して JSON 解析に失敗するため。
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          setMessage({ type: "success", text: `アップロード中… ${i + 1}/${list.length}枚（${f.name}）` });
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch(
            `/api/photo-report/upload?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
            { method: "POST", body: fd }
          );
          // 応答が JSON とは限らない（413/認証切れ等は HTML が返る）。content-type を見て安全に扱う。
          const ctype = res.headers.get("content-type") ?? "";
          const json = ctype.includes("application/json") ? await res.json() : null;
          if (!res.ok || !json) {
            const hint =
              res.status === 413
                ? "写真が大きすぎます。"
                : res.status === 401 || res.status === 403
                  ? "ログインが切れた可能性。ページを開き直してください。"
                  : "";
            throw new Error(`${f.name}: アップロード失敗（HTTP ${res.status}）${hint ? "＝" + hint : ""}`);
          }
          const u = ((json.uploaded ?? []) as Array<{ id: string; name: string }>)[0];
          if (u) {
            setItems((prev) => [
              ...prev,
              {
                fileId: u.id,
                name: u.name,
                mimeType: f.type || "image/jpeg",
                heading: "",
                annotationNote: "",
                annotations: [] as Annotation[],
                excluded: false
              }
            ]);
            ok++;
          }
        }
        setMessage({
          type: "success",
          text: `${ok}枚アップロードしました。並べ替え・見出し付けができます（「報告書保存」で新版になります）。`
        });
      } catch (e) {
        setMessage({
          type: "error",
          text: (e instanceof Error ? e.message : "アップロードに失敗しました。") + (ok > 0 ? `（${ok}枚は成功）` : "")
        });
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = ""; // 同じ写真を選び直せるように
      }
    },
    [folderId, token]
  );

  const buildReport = useCallback(() => {
    const included = items.filter((it) => !it.excluded);
    return {
      caseId,
      driveFolderId: folderId,
      // 表紙は「載せる」写真から選ぶ（除外中の写真が表紙のままにならないよう先頭にフォールバック）。
      coverFileId: included.find((it) => it.fileId === coverFileId)?.fileId ?? included[0]?.fileId,
      headerSummary: headerSummary.trim() || undefined,
      workItems: workItemsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      // photoItems は除外写真も温存（見出し/注記を残し、載せ直しても内容が消えない）。
      excludedFileIds: items.filter((it) => it.excluded).map((it) => it.fileId),
      photoItems: items.map((it) => ({
        fileId: it.fileId,
        heading: it.heading.trim() || undefined,
        annotationNote: it.annotationNote.trim() || undefined,
        annotations: it.annotations
      }))
    };
  }, [caseId, folderId, coverFileId, headerSummary, workItemsText, items]);

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
    const confirmText = reportExists
      ? "現在の設定で AI に報告書を作り直させます（現在版は上書きされます）。よろしいですか？"
      : "現在の写真と設定で AI に報告書の下書きを作らせます。よろしいですか？";
    if (!window.confirm(confirmText)) {
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
      setReportExists(true); // 依頼後は以降「再作成」表記に
      setMessage({
        type: "success",
        text: "AI生成を依頼しました。完成すると自動で通知します（数分かかります。このページは開いたままで）。"
      });
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {
        /* 通知が使えない環境は無視（アプリ内バナーで知らせる） */
      }
      setGenPolling(true);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "生成依頼に失敗しました。" });
    } finally {
      setGenerating(false);
    }
  }, [folderId, token, reportExists]);

  // PDF出力＝サーバーPDFを生成し、紐付く案件フォルダ（Drive）へ保存する（同名 upsert＝最新1つ）。
  const savePdfToDrive = useCallback(async () => {
    setPdfSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/photo-report/pdf?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}&save=1`,
        { method: "POST" }
      );
      const ctype = res.headers.get("content-type") ?? "";
      const json = ctype.includes("application/json") ? await res.json() : null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `PDFの保存に失敗しました（${res.status}）`);
      }
      setMessage({
        type: "success",
        text: `✅ 案件フォルダに「${json.name ?? "写真報告書.pdf"}」を保存しました（「プレビュー」で確認できます）。`
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "PDFの保存に失敗しました。" });
    } finally {
      setPdfSaving(false);
    }
  }, [folderId, token]);

  // 「まとめだけAI生成」＝見出しを保存してから summary ジョブを投入し、完了で概要・内容だけ反映。
  const generateSummary = useCallback(async () => {
    const hasHeading = items.some((it) => !it.excluded && it.heading.trim());
    if (!hasHeading) {
      setMessage({ type: "error", text: "先に写真の見出しを入力してください（見出しからまとめを作ります）。" });
      return;
    }
    if (
      !window.confirm(
        "見出しをもとに AI が「概要」と「内容」を作成します（写真は読みません）。現在の概要・内容は上書きされます。よろしいですか？"
      )
    ) {
      return;
    }
    setSummaryGenerating(true);
    setMessage(null);
    try {
      // worker は保存済み report の見出しを読むので、まず現在の内容を保存する。
      const saveRes = await fetch(
        `/api/photo-report/save?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report: buildReport() })
        }
      );
      const saveJson = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveJson?.error ?? `保存に失敗（${saveRes.status}）`);
      // まとめだけ生成を投入
      const res = await fetch(
        `/api/photo-report/generate?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}&mode=summary`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `依頼に失敗（${res.status}）`);
      setReportExists(true);
      setMessage({
        type: "success",
        text: "まとめを作成中です。完成すると自動で概要・内容に反映します（数十秒。このページは開いたままで）。"
      });
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {
        /* 通知不可環境は無視 */
      }
      setSummaryPolling(true);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "まとめ生成の依頼に失敗しました。" });
    } finally {
      setSummaryGenerating(false);
    }
  }, [folderId, token, items, buildReport]);

  // まとめだけAIの完了をポーリング＝概要・内容だけ差し替え（ページ全体は再読込しない＝編集を失わない）。
  useEffect(() => {
    if (!summaryPolling) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(
          `/api/photo-report/generate?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (res.ok && json.status === "done") {
          stop = true;
          setSummaryPolling(false);
          if (typeof json.headerSummary === "string") setHeaderSummary(json.headerSummary);
          if (Array.isArray(json.workItems)) setWorkItemsText(json.workItems.join("\n"));
          setMessage({
            type: "success",
            text: "✅ まとめ（概要・内容）を作成しました。内容を確認して「報告書保存」で確定できます。"
          });
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("写真報告書", { body: "まとめ（概要・内容）が完成しました。" });
            }
          } catch {
            /* noop */
          }
          return;
        }
        if (res.ok && json.status === "error") {
          stop = true;
          setSummaryPolling(false);
          setMessage({
            type: "error",
            text: `まとめの生成に失敗しました：${json.error ?? "詳細不明（少し待って再度お試しください）"}`
          });
          return;
        }
      } catch {
        /* 一時的な取得失敗は無視して継続 */
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        stop = true;
        setSummaryPolling(false);
        setMessage({ type: "error", text: "完了確認がタイムアウトしました。少し待ってページを再読み込みしてください。" });
      }
    };
    const id = setInterval(tick, 6000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [summaryPolling, folderId, token]);

  // 「AIで再作成」の完了をポーリングして知らせる（Web再作成はSlackスレッドが無いためアプリ内通知）。
  useEffect(() => {
    if (!genPolling) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(
          `/api/photo-report/generate?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (res.ok && json.status === "done") {
          stop = true;
          setGenPolling(false);
          setMessage({ type: "success", text: "✅ 完成しました。最新版を読み込みます…" });
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("写真報告書", { body: "AIの再作成が完成しました。" });
            }
          } catch {
            /* noop */
          }
          setTimeout(() => window.location.reload(), 1500);
          return;
        }
        if (res.ok && json.status === "error") {
          stop = true;
          setGenPolling(false);
          setMessage({
            type: "error",
            text: `AI生成に失敗しました：${json.error ?? "設定を見直してもう一度お試しください。"}`
          });
          return;
        }
      } catch {
        /* 一時的な取得失敗は無視して継続 */
      }
      if (Date.now() - started > 10 * 60 * 1000) {
        stop = true;
        setGenPolling(false);
        setMessage({
          type: "error",
          text: "完了確認がタイムアウトしました。少し待ってページを再読み込みしてください。"
        });
      }
    };
    const id = setInterval(tick, 8000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [genPolling, folderId, token]);

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
          body: JSON.stringify({ report: buildReport() })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `保存に失敗（${res.status}）`);
      setReportExists(true); // 保存後は報告書が存在＝以降「再作成」表記に
      setMessage({
        type: "success",
        text: `保存しました（v${json.version}）。版名は「管理」から付けられます。`
      });
      if (versionsOpen) void refreshVersions();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "保存に失敗しました。" });
    } finally {
      setSaving(false);
    }
  }, [folderId, token, buildReport, versionsOpen, refreshVersions]);

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
  // 「載せる」写真だけが本文・表紙・番号の対象。「載せない」写真は下のトレイに分けて載せ直せる。
  const includedItems = items.filter((it) => !it.excluded);
  const excludedItems = items.filter((it) => it.excluded);
  const coverItem = includedItems.find((it) => it.fileId === coverFileId) ?? includedItems[0];

  // 印刷レイアウト＝テンプレート grid-8（縦4×横2＝8枚/A4ページ）。
  // 「載せる」写真を 8 枚ずつのページに分割し、各ページを A4 固定で描く（除外写真は本文に出さない）。
  // 将来テンプレート（例 detail-3）を足すときは PHOTOS_PER_PAGE とクラスを切り替える。
  const PHOTOS_PER_PAGE = 8;
  const photoPages: EditItem[][] = [];
  for (let i = 0; i < includedItems.length; i += PHOTOS_PER_PAGE) {
    photoPages.push(includedItems.slice(i, i + PHOTOS_PER_PAGE));
  }

  return (
    <section className="panel">
      <div className="editor-topbar no-print">
        <h1>写真報告書</h1>
        <button type="button" className="btn-util" onClick={toggleVersions}>
          {versionsOpen ? "管理を閉じる" : "管理"}
        </button>
        <button type="button" className="btn-util" onClick={() => setSettingsOpen(true)}>
          ⚙️ 設定
        </button>
        <button
          type="button"
          className="btn-util"
          onClick={() => setPhotosOpen(true)}
          title="報告書に載せていない（除外中の）写真を確認・載せ直す"
        >
          🖼 写真{excludedItems.length > 0 ? `（${excludedItems.length}）` : ""}
        </button>
      </div>

      <div className="editor-actions no-print">
        <button type="button" className="btn-primary" onClick={save} disabled={saving || includedItems.length === 0}>
          {saving ? "保存中…" : "報告書保存"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={generate}
          disabled={generating || genPolling || summaryGenerating || summaryPolling}
        >
          {generating ? "依頼中…" : reportExists ? "AIで再作成" : "AIで作成"}
        </button>
        <button
          type="button"
          className="btn-output"
          onClick={savePdfToDrive}
          disabled={pdfSaving}
          title="A4 PDFを生成し、紐付く案件フォルダ（Google Drive）へ保存します（保存済みの現在版が対象）。先に保存してください。"
        >
          {pdfSaving ? "PDF作成中…" : "PDF出力（Driveへ保存）"}
        </button>
        <button
          type="button"
          className="btn-output-soft"
          onClick={() =>
            window.open(
              `/api/photo-report/pdf?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}&inline=1`,
              "_blank"
            )
          }
          title="生成したA4 PDFをその場で表示（iPhone可）。保存済みの現在版が対象。"
        >
          プレビュー
        </button>
      </div>

      <p className="editor-guide no-print">
        この画面の内容は <b>① 表紙</b> →（<b>② 写真</b>ページ）→ <b>③ まとめ</b> の順で A4 PDF になります。
        仕上げたら「報告書保存」→「PDF出力（Driveへ保存）」で案件フォルダにPDFを保存します（その場で確認は「プレビュー」＝iPhoneでも見られます）。
      </p>

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
              <label htmlFor="set-date">実施日</label>
              <input
                id="set-date"
                type="date"
                value={settings.execDate ?? ""}
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
              <td>{execDate ? formatJpDate(execDate) : "　"}</td>
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
        <div className="modal-backdrop no-print" onClick={() => setVersionsOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inline-actions" style={{ justifyContent: "space-between" }}>
              <h2>管理（版履歴・新しい順）</h2>
              <button type="button" className="btn-secondary" onClick={() => setVersionsOpen(false)}>
                閉じる
              </button>
            </div>
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
        </div>
      ) : null}

      {coverPickerOpen ? (
        <div className="modal-backdrop no-print" onClick={() => setCoverPickerOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inline-actions">
              <h2>表紙の写真を選ぶ</h2>
            </div>
            <p className="notice">フォルダの写真から表紙（PDF1ページ目）を選びます。後からいつでも入れ替えられます。</p>
            {includedItems.length === 0 ? (
              <p className="notice">写真がありません。</p>
            ) : (
              <div className="cover-grid">
                {includedItems.map((it, i) => (
                  <button
                    key={it.fileId}
                    type="button"
                    className={`cover-cell${it.fileId === coverFileId ? " selected" : ""}`}
                    onClick={() => {
                      setCoverFileId(it.fileId);
                      setCoverPickerOpen(false);
                    }}
                    title={`${i + 1}枚目${it.heading ? `「${it.heading}」` : ""}を表紙にする`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(it.fileId, folderId, token)} alt={`写真 ${i + 1}`} />
                    <span className="cover-cell-no">
                      {i + 1}
                      {it.fileId === coverFileId ? "・現在の表紙" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="inline-actions">
              <button type="button" className="btn-secondary" onClick={() => setCoverPickerOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reorderOpen ? (
        <PhotoReorderModal
          items={includedItems.map((it) => ({ fileId: it.fileId, heading: it.heading }))}
          photoUrl={(id) => photoUrl(id, folderId, token)}
          onApply={reorderByFileIds}
          onClose={() => setReorderOpen(false)}
        />
      ) : null}

      {/* 「写真」＝報告書に載せていない（除外中の）写真を確認し、載せ直す画面 */}
      {photosOpen ? (
        <div className="modal-backdrop no-print" onClick={() => setPhotosOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inline-actions" style={{ justifyContent: "space-between" }}>
              <h2>報告書に載せていない写真（{excludedItems.length}）</h2>
              <button type="button" className="btn-secondary" onClick={() => setPhotosOpen(false)}>
                閉じる
              </button>
            </div>
            <p className="notice">
              「報告書に載せない」にした写真です（Drive には残っています）。本文・表紙・AIの対象から外れています。「報告書に載せる」で戻せます。
            </p>
            {excludedItems.length === 0 ? (
              <p className="notice">除外中の写真はありません。</p>
            ) : (
              <div className="excluded-grid">
                {excludedItems.map((item) => (
                  <figure key={item.fileId} className="excluded-cell">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(item.fileId, folderId, token)} alt={item.heading || item.name} />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => patchItemById(item.fileId, { excluded: false })}
                    >
                      報告書に載せる
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ① 表紙（PDF 1ページ目）＝フォルダの写真から1枚を表紙に選ぶ（後から入替可・AIも選択） */}
      <div className="editor-section no-print">
        <h2 className="editor-section-title">① 表紙（PDF 1ページ目）</h2>
        {coverItem ? (
          <div className="cover-pick">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="cover-thumb" src={photoUrl(coverItem.fileId, folderId, token)} alt="表紙写真" />
            <div>
              <p className="editor-hint">
                現在の表紙：{includedItems.findIndex((it) => it.fileId === coverItem.fileId) + 1}枚目
                {coverItem.heading ? `「${coverItem.heading}」` : ""}。フォルダの写真から選べます（後からいつでも入替可）。
              </p>
              <button type="button" className="btn-secondary" onClick={() => setCoverPickerOpen(true)}>
                表紙を選ぶ
              </button>
            </div>
          </div>
        ) : (
          <p className="editor-hint">写真がありません。</p>
        )}
      </div>

      {/* 写真アップロード用の隠し入力（カメラ/複数選択）。トリガーは空状態と見出し横のボタン。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void uploadPhotos(e.target.files)}
      />

      {/* ② 写真（PDF本文・1ページ8枚）＝各写真に見出し・赤丸。並びは「並べ替え」モーダルで俯瞰調整 */}
      <div className="editor-section-head no-print">
        <h2 className="editor-section-title">② 写真（PDF本文・各写真に見出し／赤丸）</h2>
        <div className="editor-section-head-actions">
          {items.length > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="この報告書フォルダに写真を追加アップロードする"
            >
              {uploading ? "アップロード中…" : "＋ 写真を追加"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setReorderOpen(true)}
            disabled={includedItems.length < 2}
            title="写真の掲載順を一覧で並べ替える"
          >
            ↕ 並べ替え
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="editor-section upload-empty no-print">
          <p className="editor-hint">
            この報告書フォルダにはまだ写真がありません。現場写真をアップロードすると、ここに並んで編集できます。
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "アップロード中…" : "📷 写真をアップロード"}
          </button>
          <p className="editor-hint">
            スマホのカメラ／写真から複数選べます。アップロード後に「AIで作成」で下書きできます。
          </p>
        </div>
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
                    <div className="photo-card-badges no-print">
                      {isCover ? <div className="cover-badge">★ 表紙にも使われています</div> : null}
                      <button
                        type="button"
                        className="btn-exclude"
                        title="この写真を報告書に載せない（Drive には残ります・あとで載せ直せます）"
                        onClick={() => patchItemById(item.fileId, { excluded: true })}
                      >
                        報告書に載せない
                      </button>
                    </div>
                    <PhotoAnnotator
                      src={photoUrl(item.fileId, folderId, token)}
                      alt={item.heading || item.name}
                      value={item.annotations}
                      onChange={(next) => patchItemById(item.fileId, { annotations: next })}
                      compact
                    />
                    <figcaption className="editor-field no-print">
                      <label htmlFor={`h-${item.fileId}`}>見出し（写真 {index + 1}）</label>
                      <input
                        id={`h-${item.fileId}`}
                        type="text"
                        value={item.heading}
                        maxLength={80}
                        placeholder={`写真 ${index + 1}`}
                        onChange={(e) => patchItemById(item.fileId, { heading: e.target.value })}
                      />
                      {/* 所見は grid-8 PDF に出ないため一旦非表示（detail-3 等のカット追加時に再表示）。データ(annotationNote)は保持。 */}
                      {item.annotations.length > 0 ? (
                        <p className="notice no-print">図形 {item.annotations.length} 件（保存に含まれます）</p>
                      ) : null}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ③ まとめ（PDFの最終ページ＝概要・内容・免責）。画面でここを編集すると下のPDF体裁に出る */}
      <div className="editor-section no-print">
        <div className="editor-section-head">
          <h2 className="editor-section-title">③ まとめ（PDFの最終ページ）</h2>
          <div className="editor-section-head-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={generateSummary}
              disabled={
                summaryGenerating || summaryPolling || generating || genPolling || includedItems.length === 0
              }
              title="写真の見出しをもとに、AIが概要と内容を作成します（写真は読まない軽量生成）"
            >
              {summaryGenerating || summaryPolling ? "作成中…" : "✨ まとめだけAI生成"}
            </button>
          </div>
        </div>
        {summaryGenerating || summaryPolling ? (
          <p className="notice">AIが概要・内容を作成中です…（完成すると自動で反映されます）</p>
        ) : null}
        <div className="editor-field">
          <label htmlFor="headerSummary">{kindLabel}概要（まとめ文章）</label>
          <textarea
            id="headerSummary"
            className="summary-inline"
            value={headerSummary}
            readOnly
            rows={3}
            disabled={summaryGenerating || summaryPolling}
            placeholder="タップして概要を編集（任意）"
            onClick={() => openSummary("headerSummary")}
          />
        </div>
        <div className="editor-field">
          <label htmlFor="workItems">{kindLabel}内容（1行に1項目）</label>
          <textarea
            id="workItems"
            className="summary-inline"
            value={workItemsText}
            readOnly
            rows={4}
            disabled={summaryGenerating || summaryPolling}
            placeholder={"タップして内容を編集（1行に1項目）"}
            onClick={() => openSummary("workItems")}
          />
        </div>
      </div>

      {/* まとめ文章の別窓エディタ（広い textarea で編集） */}
      {summaryEdit ? (
        <div className="modal-backdrop no-print" onClick={closeSummary}>
          <div className="modal summary-edit-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="inline-actions" style={{ justifyContent: "space-between" }}>
              <h2>
                {summaryEdit === "headerSummary"
                  ? `${kindLabel}概要（まとめ文章）`
                  : `${kindLabel}内容（1行に1項目）`}
              </h2>
              <button type="button" className="btn-secondary" onClick={closeSummary}>
                閉じる
              </button>
            </div>
            <textarea
              autoFocus
              className="summary-edit-area"
              value={summaryDraft}
              maxLength={summaryEdit === "headerSummary" ? 2000 : 3000}
              placeholder={
                summaryEdit === "headerSummary"
                  ? "現場全体のまとめ（任意）"
                  : "例:\n101号室、102号室及び103号室の床下に木部剤及び土壌剤を散布処理\n101号室、102号室及び103号室の風呂場の壁面を穿孔し薬剤を注入処理"
              }
              onChange={(e) => setSummaryDraft(e.target.value)}
            />
            <p className="editor-hint">閉じると内容が反映されます（「報告書保存」で新版になります）。</p>
          </div>
        </div>
      ) : null}

      {/* ===== 印刷(PDF) 最終ページ：概要／内容／免責 ===== */}
      <div className="print-only print-summary">
        <div className="summary-head">
          <span className="summary-property">{propertyLabel}</span>
          <span className="summary-date">実施日　{formatJpDate(execDate)}</span>
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
