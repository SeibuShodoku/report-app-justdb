import { describe, expect, it } from "vitest";
import { photoReportDraftSchema } from "@/schemas/photo-report";

const validDraft = {
  caseId: "CASE-001",
  constructionId: "CON-001",
  driveFolderId: "1AbCdEfGhIjK",
  headerSummary: "現地写真の所見をまとめました。",
  reporter: "AI下書き",
  generatedAt: "2026-06-18T10:00:00.000Z",
  photoItems: [
    { fileId: "file-1", heading: "玄関", annotationNote: "侵入経路に印" },
    { fileId: "file-2" }
  ]
};

describe("photoReportDraftSchema", () => {
  it("正しい下書きを受け付ける", () => {
    expect(photoReportDraftSchema.safeParse(validDraft).success).toBe(true);
  });

  it("写真は fileId 参照（絶対URL不要）", () => {
    const result = photoReportDraftSchema.safeParse({
      ...validDraft,
      photoItems: [{ fileId: "only-id" }]
    });
    expect(result.success).toBe(true);
  });

  it("driveFolderId が無いと却下", () => {
    const { driveFolderId, ...rest } = validDraft;
    void driveFolderId;
    expect(photoReportDraftSchema.safeParse(rest).success).toBe(false);
  });

  it("写真0件は却下（min 1）", () => {
    expect(
      photoReportDraftSchema.safeParse({ ...validDraft, photoItems: [] }).success
    ).toBe(false);
  });

  it("10枚を超えても受け付ける（Drive直投入で枚数無制限）", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ fileId: `f-${i}` }));
    expect(
      photoReportDraftSchema.safeParse({ ...validDraft, photoItems: many }).success
    ).toBe(true);
  });
});
