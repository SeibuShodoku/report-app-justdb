import { describe, expect, it } from "vitest";
import { caseDigestWriteSchema } from "@/schemas/case-digest";
import { appendSlackHistory } from "@/lib/case-digest";

describe("caseDigestWriteSchema", () => {
  const base = { caseId: "C-1", driveFolderId: "FID", coreMarkdown: "# ダイジェスト\n本文" };
  it("最小入力を受け付ける", () => {
    expect(caseDigestWriteSchema.safeParse(base).success).toBe(true);
  });
  it("slackSummary は任意", () => {
    expect(caseDigestWriteSchema.safeParse({ ...base, slackSummary: "要約" }).success).toBe(true);
  });
  it("coreMarkdown 空は却下", () => {
    expect(caseDigestWriteSchema.safeParse({ ...base, coreMarkdown: "" }).success).toBe(false);
  });
  it("driveFolderId 欠落は却下", () => {
    const { driveFolderId, ...rest } = base;
    void driveFolderId;
    expect(caseDigestWriteSchema.safeParse(rest).success).toBe(false);
  });
});

describe("appendSlackHistory", () => {
  it("空履歴ならヘッダ＋エントリを作る", () => {
    const out = appendSlackHistory(null, "最初の要約", "2026-06-19T10:00:00Z");
    expect(out).toContain("# Slack要約 履歴");
    expect(out).toContain("## 2026-06-19T10:00:00Z");
    expect(out).toContain("最初の要約");
  });
  it("既存履歴に追記し、過去分を残す（時系列）", () => {
    const first = appendSlackHistory(null, "古い要約", "2026-06-19T10:00:00Z");
    const second = appendSlackHistory(first, "新しい要約", "2026-06-19T12:00:00Z");
    expect(second).toContain("古い要約");
    expect(second).toContain("新しい要約");
    // 古い方が新しい方より前（時系列・末尾追記）
    expect(second.indexOf("古い要約")).toBeLessThan(second.indexOf("新しい要約"));
    // ヘッダは1つだけ
    expect(second.match(/# Slack要約 履歴/g)?.length).toBe(1);
  });
});
