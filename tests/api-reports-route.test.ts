import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/reports/route";

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

function createSubmission(token: string) {
  return {
    caseId: "CASE-001",
    investigationId: "INV-001",
    constructionId: "CON-001",
    driveFolderUrl: "https://drive.google.com/drive/folders/folder001",
    token,
    title: "点検報告",
    reporter: "石橋",
    category: "daily",
    photoItems: [
      {
        heading: "設備A",
        imageUrl: "https://example.com/a.jpg",
        annotationNote: "マーキングあり"
      }
    ],
    detailFindings: "異常なし"
  };
}

function createSubmissionWithoutToken() {
  return {
    caseId: "CASE-001",
    investigationId: "INV-001",
    constructionId: "CON-001",
    driveFolderUrl: "https://drive.google.com/drive/folders/folder001",
    title: "点検報告",
    reporter: "石橋",
    category: "daily",
    photoItems: [],
    detailFindings: "異常なし"
  };
}

let storageDir = "";

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), `report-app-test-${randomUUID()}-`));
  process.env.REPORT_STORAGE_DIR = storageDir;
  process.env.REPORT_LINK_SECRET = "test-secret-with-minimum-16";
});

afterEach(async () => {
  await rm(storageDir, { recursive: true, force: true });
  delete process.env.REPORT_STORAGE_DIR;
  delete process.env.REPORT_LINK_SECRET;
});

describe("POST /api/reports", () => {
  it("正常入力を保存して201を返す", async () => {
    const token = createToken(
      {
        caseId: "CASE-001",
        investigationId: "INV-001",
        constructionId: "CON-001",
        exp: Math.floor(Date.now() / 1000) + 300
      },
      process.env.REPORT_LINK_SECRET ?? ""
    );

    const request = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSubmission(token))
    });

    const response = await POST(request);
    const body = (await response.json()) as { ok?: boolean; reportId?: string };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.reportId).toBeTruthy();

    const files = await readdir(storageDir);
    expect(files.length).toBe(1);

    const saved = await readFile(join(storageDir, files[0]), "utf-8");
    expect(saved).toContain("CASE-001");
    expect(saved).not.toContain('"token"');
  });

  it("トークン不一致時は403を返す", async () => {
    const token = createToken(
      {
        caseId: "CASE-999",
        investigationId: "INV-001",
        constructionId: "CON-001",
        exp: Math.floor(Date.now() / 1000) + 300
      },
      process.env.REPORT_LINK_SECRET ?? ""
    );

    const request = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSubmission(token))
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("スキーマ不正時は400を返す", async () => {
    const request = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: "CASE-001" })
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("トークンなしでも保存できる", async () => {
    const request = new Request("http://localhost/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSubmissionWithoutToken())
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});
