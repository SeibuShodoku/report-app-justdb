import { describe, expect, it } from "vitest";
import { buildVersionFile } from "@/lib/report-versions";
import { preventionReportDraftSchema } from "@/schemas/prevention-report";

const base = { caseId: "012345", driveFolderId: "FOLDER_X" };

describe("preventionReportDraftSchema（使用薬剤必須）", () => {
  it("施工内容に薬剤が1つでもあれば成功", () => {
    const r = preventionReportDraftSchema.safeParse({
      ...base,
      workItems: [{ id: "a", pest: "ネズミ", chemical: "クマリン系粉剤", method: "交換", amount: "100g" }]
    });
    expect(r.success).toBe(true);
  });

  it("施工内容はあるが薬剤が全て空なら失敗（使用薬剤必須）", () => {
    const r = preventionReportDraftSchema.safeParse({
      ...base,
      workItems: [{ id: "a", pest: "ネズミ", chemical: "", method: "交換", amount: "" }]
    });
    expect(r.success).toBe(false);
  });

  it("施工内容が空でも失敗（薬剤なし）", () => {
    const r = preventionReportDraftSchema.safeParse({ ...base, workItems: [] });
    expect(r.success).toBe(false);
  });

  it("caseId / driveFolderId は必須", () => {
    const r = preventionReportDraftSchema.safeParse({
      workItems: [{ id: "a", chemical: "X" }]
    });
    expect(r.success).toBe(false);
  });
});

describe("buildVersionFile（reportType）", () => {
  it("既定は photo（後方互換）", () => {
    const f = buildVersionFile({ version: 1, report: {}, source: "human" });
    expect(f.reportType).toBe("photo");
  });
  it("prevention を指定できる", () => {
    const f = buildVersionFile({ version: 1, report: {}, source: "human", reportType: "prevention" });
    expect(f.reportType).toBe("prevention");
  });
});
