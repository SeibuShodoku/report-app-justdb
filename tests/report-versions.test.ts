import { describe, expect, it } from "vitest";
import {
  buildVersionFile,
  formatVersionFileName,
  nextVersionNumber,
  parseVersionNumber
} from "@/lib/report-versions";
import type { PhotoReportDraft } from "@/schemas/photo-report";

describe("parseVersionNumber", () => {
  it("v0001.json → 1（ゼロ詰めを数値化）", () => {
    expect(parseVersionNumber("v0001.json")).toBe(1);
    expect(parseVersionNumber("v0042.json")).toBe(42);
    expect(parseVersionNumber("v123456.json")).toBe(123456);
  });
  it("版ファイルでなければ null", () => {
    expect(parseVersionNumber("digest.md")).toBeNull();
    expect(parseVersionNumber("v.json")).toBeNull();
    expect(parseVersionNumber("v0001.txt")).toBeNull();
    expect(parseVersionNumber("report-v1.json")).toBeNull();
    expect(parseVersionNumber("v0000.json")).toBeNull(); // 0 は無効
  });
});

describe("formatVersionFileName", () => {
  it("4桁ゼロ詰め", () => {
    expect(formatVersionFileName(1)).toBe("v0001.json");
    expect(formatVersionFileName(42)).toBe("v0042.json");
    expect(formatVersionFileName(12345)).toBe("v12345.json"); // 桁が伸びても可
  });
  it("不正な版番号は例外", () => {
    expect(() => formatVersionFileName(0)).toThrow();
    expect(() => formatVersionFileName(-1)).toThrow();
    expect(() => formatVersionFileName(1.5)).toThrow();
  });
});

describe("nextVersionNumber", () => {
  it("空なら 1", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber(["digest.md", "slack-summary-history.md"])).toBe(1);
  });
  it("最大版＋1（穴あき・非版ファイル混在でも最大基準）", () => {
    expect(nextVersionNumber(["v0001.json", "v0002.json"])).toBe(3);
    expect(nextVersionNumber(["v0003.json", "v0001.json", "notes.md"])).toBe(4); // 穴(v2欠番)でも最大+1
  });
});

describe("buildVersionFile", () => {
  const report: PhotoReportDraft = {
    caseId: "C1",
    driveFolderId: "F1",
    photoItems: [{ fileId: "a", annotations: [] }]
  };
  it("自己記述（version/generatedAt/source/report）を組み立てる", () => {
    const now = new Date("2026-06-19T08:00:00.000Z");
    const f = buildVersionFile({ version: 2, report, source: "human", note: "修正", now });
    expect(f).toMatchObject({
      version: 2,
      generatedAt: "2026-06-19T08:00:00.000Z",
      source: "human",
      note: "修正"
    });
    expect(f.report.caseId).toBe("C1");
  });
  it("note/folderName は無ければキー自体を出さない", () => {
    const f = buildVersionFile({ version: 1, report, source: "ai" });
    expect("note" in f).toBe(false);
    expect("folderName" in f).toBe(false);
  });
});
