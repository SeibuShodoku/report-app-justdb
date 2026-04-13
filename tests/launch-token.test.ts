import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifyLaunchToken } from "@/lib/security/launch-token";

/**
 * テスト用に署名付きトークンを生成する。
 */
function createToken(payload: Record<string, unknown>, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString(
    "base64url"
  );
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

afterEach(() => {
  delete process.env.REPORT_LINK_SECRET;
});

describe("verifyLaunchToken", () => {
  it("有効なトークンを検証できる", () => {
    process.env.REPORT_LINK_SECRET = "test-secret-with-minimum-16";
    const token = createToken(
      {
        caseId: "CASE-001",
        investigationId: "INV-001",
        constructionId: "CON-001",
        driveFolderId: "FOLDER-001",
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      process.env.REPORT_LINK_SECRET
    );

    const payload = verifyLaunchToken(token);

    expect(payload.caseId).toBe("CASE-001");
    expect(payload.investigationId).toBe("INV-001");
    expect(payload.constructionId).toBe("CON-001");
    expect(payload.driveFolderId).toBe("FOLDER-001");
  });

  it("期限切れトークンを拒否する", () => {
    process.env.REPORT_LINK_SECRET = "test-secret-with-minimum-16";
    const token = createToken(
      {
        caseId: "CASE-001",
        exp: Math.floor(Date.now() / 1000) - 1
      },
      process.env.REPORT_LINK_SECRET
    );

    expect(() => verifyLaunchToken(token)).toThrow("有効期限");
  });

  it("署名不一致のトークンを拒否する", () => {
    process.env.REPORT_LINK_SECRET = "test-secret-with-minimum-16";
    const token = createToken(
      {
        caseId: "CASE-001",
        exp: Math.floor(Date.now() / 1000) + 300
      },
      "another-secret-with-minimum-16"
    );

    expect(() => verifyLaunchToken(token)).toThrow("署名");
  });
});
