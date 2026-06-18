import { describe, expect, it } from "vitest";
import { imagesToView, photoProxyUrl } from "@/lib/photo-report-source";
import type { DriveImage } from "@/lib/drive";

const images: DriveImage[] = [
  { fileId: "f1", name: "DSC_0001.jpg", mimeType: "image/jpeg", createdTime: "2026-06-18T01:00:00Z" },
  { fileId: "f2", name: "DSC_0002.jpg", mimeType: "image/jpeg", createdTime: "2026-06-18T01:01:00Z" }
];

describe("imagesToView", () => {
  it("フォルダ画像を写真報告ビューへ変換する（見出し・注記なし）", () => {
    const view = imagesToView("CASE-1", "FID", images);
    expect(view.caseId).toBe("CASE-1");
    expect(view.driveFolderId).toBe("FID");
    expect(view.photoItems).toHaveLength(2);
    expect(view.photoItems[0]).toMatchObject({ fileId: "f1", name: "DSC_0001.jpg" });
    expect(view.photoItems[0].heading).toBeUndefined();
  });

  it("0枚でも空ビューを返す", () => {
    expect(imagesToView("C", "F", []).photoItems).toEqual([]);
  });
});

describe("photoProxyUrl", () => {
  it("fileId/folderId/token をクエリに乗せる", () => {
    const url = photoProxyUrl("f1", "FID", "tok");
    expect(url.startsWith("/api/photo?")).toBe(true);
    expect(url).toContain("fileId=f1");
    expect(url).toContain("folderId=FID");
    expect(url).toContain("token=tok");
  });

  it("特殊文字をエスケープする", () => {
    const url = photoProxyUrl("a b", "F/D", "t&k");
    expect(url).toContain("fileId=a+b");
    expect(url).toContain("folderId=F%2FD");
    expect(url).toContain("token=t%26k");
  });
});
