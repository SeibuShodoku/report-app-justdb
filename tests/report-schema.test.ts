import { describe, expect, it } from "vitest";
import { reportSubmissionSchema } from "@/schemas/report";

const validPayload = {
  caseId: "CASE-001",
  investigationId: "INV-001",
  constructionId: "CON-001",
  driveFolderUrl: "https://drive.google.com/drive/folders/aaa",
  token: "abcdefghijklmnopqrstuvwx",
  title: "定期点検報告",
  reporter: "石橋",
  category: "daily",
  coverPhotoUrl: "https://example.com/cover.jpg",
  headerSummary: "現地確認の結果を報告します。",
  photoItems: [
    {
      heading: "設備A",
      imageUrl: "https://example.com/photo-1.jpg",
      annotationNote: "配管付近に印を追加"
    }
  ],
  detailFindings: "異常なし",
  detailActionsTaken: "清掃を実施",
  detailNextActions: "次回点検予定"
};

describe("reportSubmissionSchema", () => {
  it("正しい入力を受け付ける", () => {
    const result = reportSubmissionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("写真が9件以上だとエラーになる", () => {
    const payload = {
      ...validPayload,
      photoItems: Array.from({ length: 9 }, (_, index) => ({
        heading: `写真${index + 1}`,
        imageUrl: `https://example.com/photo-${index + 1}.jpg`
      }))
    };

    const result = reportSubmissionSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it("所見が空だとエラーになる", () => {
    const payload = { ...validPayload, detailFindings: "" };
    const result = reportSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
