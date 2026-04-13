import { createHmac } from "node:crypto";

/**
 * 開発用の起動トークンを生成する。
 *
 * usage:
 * REPORT_LINK_SECRET=xxx node scripts/generate-launch-token.mjs CASE001 INV001 CONST001 FOLDER123 3600
 */
function main() {
  const [, , caseId, investigationId = "", constructionId = "", driveFolderId = "", ttl = "1800"] = process.argv;

  if (!caseId) {
    throw new Error("caseId を指定してください。");
  }

  const secret = process.env.REPORT_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("REPORT_LINK_SECRET が未設定か短すぎます。");
  }

  const exp = Math.floor(Date.now() / 1000) + Number(ttl);
  const payload = {
    caseId,
    investigationId: investigationId || undefined,
    constructionId: constructionId || undefined,
    driveFolderId: driveFolderId || undefined,
    exp
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const token = `${encodedPayload}.${signature}`;
  const query = new URLSearchParams({
    caseId,
    ...(investigationId ? { investigationId } : {}),
    ...(constructionId ? { constructionId } : {}),
    ...(driveFolderId ? { driveFolderId } : {}),
    token
  });

  console.log(token);
  console.log(`/report/new?${query.toString()}`);
}

main();
