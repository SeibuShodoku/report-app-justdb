"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { LaunchContext } from "@/schemas/report";

type SubmitState = {
  status: "idle" | "submitting" | "success" | "error";
  message?: string;
};

type PhotoDraft = {
  heading: string;
  imageUrl: string;
  annotationNote: string;
  sourceFileName?: string;
};

type ImportedPhoto = {
  id: string;
  fileName: string;
  objectUrl: string;
};

type ReportFormProps = {
  launchContext: LaunchContext;
};

type ReportConfig = {
  version: "1";
  title: string;
  reporter: string;
  category: string;
  coverPhotoUrl: string;
  headerSummary: string;
  detailFindings: string;
  detailActionsTaken: string;
  detailNextActions: string;
  photoItems: PhotoDraft[];
};

const DEFAULT_PHOTO_COUNT = 8;

function createEmptyPhotoItems(): PhotoDraft[] {
  return Array.from({ length: DEFAULT_PHOTO_COUNT }, () => ({
    heading: "",
    imageUrl: "",
    annotationNote: "",
    sourceFileName: ""
  }));
}

/**
 * 報告書入力フォーム。
 * 1ページ目、写真報告ページ、最終ページの情報をまとめて送信する。
 */
export function ReportForm({ launchContext }: ReportFormProps) {
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const [photoItems, setPhotoItems] = useState<PhotoDraft[]>(createEmptyPhotoItems);
  const [importedPhotos, setImportedPhotos] = useState<ImportedPhoto[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const configInputRef = useRef<HTMLInputElement | null>(null);

  const onChangePhotoField = (
    index: number,
    key: keyof PhotoDraft,
    value: string
  ) => {
    setPhotoItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const importedCountText = useMemo(
    () => `取り込み済み: ${importedPhotos.length}件`,
    [importedPhotos.length]
  );

  const onImportLocalPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const nextPhotos: ImportedPhoto[] = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        objectUrl: URL.createObjectURL(file)
      }));

    setImportedPhotos((prev) => [...prev, ...nextPhotos]);
  };

  const assignImportedPhotoToSlot = (slotIndex: number, photo: ImportedPhoto) => {
    setPhotoItems((prev) => {
      const next = [...prev];
      next[slotIndex] = {
        ...next[slotIndex],
        imageUrl: photo.objectUrl,
        sourceFileName: photo.fileName,
        heading: next[slotIndex].heading || photo.fileName
      };
      return next;
    });
  };

  const applyImportedPhotosSequentially = () => {
    setPhotoItems((prev) => {
      const next = [...prev];
      importedPhotos.slice(0, DEFAULT_PHOTO_COUNT).forEach((photo, index) => {
        next[index] = {
          ...next[index],
          imageUrl: photo.objectUrl,
          sourceFileName: photo.fileName,
          heading: next[index].heading || photo.fileName
        };
      });
      return next;
    });
  };

  const onExportConfig = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const config: ReportConfig = {
      version: "1",
      title: String(formData.get("title") ?? ""),
      reporter: String(formData.get("reporter") ?? ""),
      category: String(formData.get("category") ?? "daily"),
      coverPhotoUrl: String(formData.get("coverPhotoUrl") ?? ""),
      headerSummary: String(formData.get("headerSummary") ?? ""),
      detailFindings: String(formData.get("detailFindings") ?? ""),
      detailActionsTaken: String(formData.get("detailActionsTaken") ?? ""),
      detailNextActions: String(formData.get("detailNextActions") ?? ""),
      photoItems
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json"
    });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `report-config-${launchContext.caseId}.json`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);

    setState({
      status: "success",
      message: "設定ファイルを保存しました。"
    });
  };

  const onImportConfig = async (file: File | null, form: HTMLFormElement) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const config = JSON.parse(text) as ReportConfig;

      if (!config || config.version !== "1") {
        throw new Error("設定ファイルの形式が不正です。");
      }

      (form.elements.namedItem("title") as HTMLInputElement).value = config.title;
      (form.elements.namedItem("reporter") as HTMLInputElement).value =
        config.reporter;
      (form.elements.namedItem("category") as HTMLSelectElement).value =
        config.category;
      (form.elements.namedItem("coverPhotoUrl") as HTMLInputElement).value =
        config.coverPhotoUrl;
      (form.elements.namedItem("headerSummary") as HTMLTextAreaElement).value =
        config.headerSummary;
      (form.elements.namedItem("detailFindings") as HTMLTextAreaElement).value =
        config.detailFindings;
      (form.elements.namedItem("detailActionsTaken") as HTMLTextAreaElement).value =
        config.detailActionsTaken;
      (form.elements.namedItem("detailNextActions") as HTMLTextAreaElement).value =
        config.detailNextActions;

      setPhotoItems(
        createEmptyPhotoItems().map((item, index) => ({
          ...item,
          ...config.photoItems[index]
        }))
      );

      setState({
        status: "success",
        message: "設定ファイルを読み込みました。"
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "設定ファイルの読み込みに失敗しました。"
      });
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const payload = {
      ...launchContext,
      title: String(formData.get("title") ?? ""),
      reporter: String(formData.get("reporter") ?? ""),
      category: String(formData.get("category") ?? "daily"),
      coverPhotoUrl: String(formData.get("coverPhotoUrl") ?? "") || undefined,
      headerSummary: String(formData.get("headerSummary") ?? "") || undefined,
      photoItems: photoItems
        .filter((item) => item.imageUrl.trim().length > 0)
        .map((item) => ({
          heading: item.heading,
          imageUrl: item.imageUrl,
          annotationNote: item.annotationNote
        })),
      detailFindings: String(formData.get("detailFindings") ?? ""),
      detailActionsTaken:
        String(formData.get("detailActionsTaken") ?? "") || undefined,
      detailNextActions:
        String(formData.get("detailNextActions") ?? "") || undefined
    };

    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "送信に失敗しました。設定を確認してください。");
      }

      setState({ status: "success", message: "報告書を登録しました。" });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "送信中に不明なエラーが発生しました。"
      });
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <section className="section-block">
        <h2>設定ファイル</h2>
        <div className="inline-actions">
          <button
            type="button"
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (form) {
                onExportConfig(form);
              }
            }}
          >
            設定を保存（JSON）
          </button>
          <button
            type="button"
            onClick={() => {
              configInputRef.current?.click();
            }}
          >
            設定を読込（JSON）
          </button>
        </div>
        <input
          ref={configInputRef}
          type="file"
          accept="application/json"
          className="hidden-input"
          onChange={(event) => {
            const form = event.currentTarget.form;
            if (form) {
              void onImportConfig(event.currentTarget.files?.[0] ?? null, form);
            }
            event.currentTarget.value = "";
          }}
        />
      </section>

      <section className="section-block">
        <h2>1ページ目: 表紙</h2>
        <div>
          <label htmlFor="caseId">案件ID</label>
          <input id="caseId" value={launchContext.caseId} readOnly />
        </div>

        <div>
          <label htmlFor="title">タイトル</label>
          <input id="title" name="title" required maxLength={120} />
        </div>

        <div>
          <label htmlFor="reporter">報告者</label>
          <input id="reporter" name="reporter" required maxLength={80} />
        </div>

        <div>
          <label htmlFor="category">報告区分</label>
          <select id="category" name="category" defaultValue="daily">
            <option value="daily">日報</option>
            <option value="incident">障害報告</option>
            <option value="proposal">改善提案</option>
          </select>
        </div>

        <div>
          <label htmlFor="coverPhotoUrl">見出し写真URL（任意）</label>
          <input id="coverPhotoUrl" name="coverPhotoUrl" type="url" />
        </div>

        <div>
          <label htmlFor="headerSummary">ヘッダー説明（任意）</label>
          <textarea id="headerSummary" name="headerSummary" maxLength={1000} />
        </div>
      </section>

      <section className="section-block">
        <h2>中間ページ: 写真報告（8枚レイアウト）</h2>
        <div className="inline-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            写真を選択
          </button>
          <button type="button" onClick={() => folderInputRef.current?.click()}>
            フォルダを選択
          </button>
          <button type="button" onClick={applyImportedPhotosSequentially}>
            先頭から8枠へ自動配置
          </button>
          <span className="notice">{importedCountText}</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden-input"
          onChange={(event) => {
            onImportLocalPhotos(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden-input"
          onChange={(event) => {
            onImportLocalPhotos(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />

        {importedPhotos.length > 0 ? (
          <div className="imported-photo-list">
            {importedPhotos.map((photo) => (
              <article key={photo.id} className="imported-photo-item">
                <Image
                  src={photo.objectUrl}
                  alt={photo.fileName}
                  width={400}
                  height={240}
                  unoptimized
                />
                <p title={photo.fileName}>{photo.fileName}</p>
                <div className="slot-buttons">
                  {Array.from({ length: DEFAULT_PHOTO_COUNT }, (_, slotIndex) => (
                    <button
                      key={`${photo.id}-${slotIndex + 1}`}
                      type="button"
                      onClick={() => assignImportedPhotoToSlot(slotIndex, photo)}
                    >
                      枠{slotIndex + 1}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="photo-grid">
          {photoItems.map((item, index) => (
            <article className="photo-card" key={`photo-${index + 1}`}>
              <h3>写真 {index + 1}</h3>
              {item.imageUrl ? (
                <Image
                  className="photo-preview"
                  src={item.imageUrl}
                  alt={item.sourceFileName || `写真${index + 1}`}
                  width={800}
                  height={450}
                  unoptimized
                />
              ) : null}
              {item.sourceFileName ? (
                <p className="notice">元ファイル: {item.sourceFileName}</p>
              ) : null}

              <label htmlFor={`photo-heading-${index}`}>見出し</label>
              <input
                id={`photo-heading-${index}`}
                value={item.heading}
                maxLength={80}
                onChange={(event) =>
                  onChangePhotoField(index, "heading", event.currentTarget.value)
                }
              />

              <label htmlFor={`photo-url-${index}`}>画像URL</label>
              <input
                id={`photo-url-${index}`}
                type="url"
                value={item.imageUrl}
                onChange={(event) =>
                  onChangePhotoField(index, "imageUrl", event.currentTarget.value)
                }
              />

              <label htmlFor={`photo-note-${index}`}>注記メモ</label>
              <textarea
                id={`photo-note-${index}`}
                value={item.annotationNote}
                maxLength={500}
                onChange={(event) =>
                  onChangePhotoField(
                    index,
                    "annotationNote",
                    event.currentTarget.value
                  )
                }
              />
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <h2>最終ページ: 詳細報告</h2>

        <div>
          <label htmlFor="detailFindings">所見（必須）</label>
          <textarea
            id="detailFindings"
            name="detailFindings"
            required
            maxLength={4000}
          />
        </div>

        <div>
          <label htmlFor="detailActionsTaken">実施内容（任意）</label>
          <textarea
            id="detailActionsTaken"
            name="detailActionsTaken"
            maxLength={4000}
          />
        </div>

        <div>
          <label htmlFor="detailNextActions">次アクション（任意）</label>
          <textarea
            id="detailNextActions"
            name="detailNextActions"
            maxLength={4000}
          />
        </div>
      </section>

      <button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "送信中..." : "報告書を登録"}
      </button>

      {state.message ? (
        <p className={`notice ${state.status === "error" ? "error" : "success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
