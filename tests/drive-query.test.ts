import { describe, expect, it } from "vitest";
import { buildFolderImagesQuery } from "@/lib/drive";

describe("buildFolderImagesQuery", () => {
  it("親フォルダ・画像・未ゴミ箱で絞る", () => {
    const q = buildFolderImagesQuery("FID123");
    expect(q).toContain("'FID123' in parents");
    expect(q).toContain("mimeType contains 'image/'");
    expect(q).toContain("trashed = false");
  });

  it("folderId 内のシングルクオートをエスケープ（クエリ・インジェクション防止）", () => {
    const q = buildFolderImagesQuery("a'b");
    expect(q).toContain("'a\\'b' in parents");
  });
});
