import { describe, expect, it } from "vitest";
import {
  overlayReport,
  type PhotoReportView,
  type StoredReportJson
} from "@/lib/photo-report-source";

const view: PhotoReportView = {
  caseId: "C1",
  driveFolderId: "F1",
  photoItems: [
    { fileId: "a", name: "a.jpg", mimeType: "image/jpeg", annotations: [] },
    { fileId: "b", name: "b.jpg", mimeType: "image/jpeg", annotations: [] },
    { fileId: "c", name: "c.jpg", mimeType: "image/jpeg", annotations: [] }
  ]
};

describe("overlayReport", () => {
  it("stored が null なら素のビューを返す", () => {
    expect(overlayReport(view, null)).toBe(view);
  });

  it("見出し/注記/要約/並びを保存JSONで上書きする", () => {
    const stored: StoredReportJson = {
      headerSummary: "現場まとめ",
      photoItems: [
        { fileId: "b", heading: "玄関", annotationNote: "侵入経路" },
        { fileId: "a", heading: "台所" }
      ]
    };
    const out = overlayReport(view, stored);
    expect(out.headerSummary).toBe("現場まとめ");
    // 並びは stored 優先（b, a）→ 残り c を末尾
    expect(out.photoItems.map((p) => p.fileId)).toEqual(["b", "a", "c"]);
    expect(out.photoItems[0]).toMatchObject({ heading: "玄関", annotationNote: "侵入経路" });
    expect(out.photoItems[1].heading).toBe("台所");
    // フォルダ画像のメタ（name/mime）は保持
    expect(out.photoItems[0].name).toBe("b.jpg");
  });

  it("annotations(赤丸など)を保存JSONから引き継ぐ", () => {
    const stored: StoredReportJson = {
      photoItems: [
        {
          fileId: "a",
          annotations: [
            { id: "x1", type: "circle", points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], color: "#e11" }
          ]
        }
      ]
    };
    const out = overlayReport(view, stored);
    const a = out.photoItems.find((p) => p.fileId === "a");
    expect(a?.annotations).toHaveLength(1);
    expect(a?.annotations?.[0]).toMatchObject({ type: "circle", color: "#e11" });
    // 上書きされない写真は空配列のまま
    expect(out.photoItems.find((p) => p.fileId === "b")?.annotations).toEqual([]);
  });

  it("JSONにあるがフォルダに無いfileIdはスキップ", () => {
    const stored: StoredReportJson = {
      photoItems: [{ fileId: "zzz", heading: "幽霊" }, { fileId: "a", heading: "実在" }]
    };
    const out = overlayReport(view, stored);
    expect(out.photoItems.map((p) => p.fileId)).toEqual(["a", "b", "c"]);
    expect(out.photoItems.find((p) => p.fileId === "a")?.heading).toBe("実在");
  });
});
