"use server";

/**
 * 案件ポータルのサーバーアクション（正本指定）。
 * 認可は resolveCaseAccess（surface="portal"）＝ページと同じ門を通す。
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { writeCanonicalReport } from "@/lib/case-canonical";
import { resolveCaseAccess } from "@/lib/security/case-access";
import { iapUserEmail } from "@/lib/security/iap-user";

export async function setCanonicalAction(formData: FormData): Promise<void> {
  const caseId = String(formData.get("caseId") ?? "").trim();
  const folderId = String(formData.get("folderId") ?? "").trim();
  const topFolderId = String(formData.get("topFolderId") ?? "").trim();

  const email = iapUserEmail(await headers());
  const access = resolveCaseAccess({ kind: "staff", email }, caseId, "portal");
  if (!access.allowed) throw new Error(access.reason);
  if (!folderId) throw new Error("folderId が必要です。");

  await writeCanonicalReport(caseId, folderId, email);

  const back =
    `/portal?caseId=${encodeURIComponent(caseId)}` +
    (topFolderId ? `&topFolderId=${encodeURIComponent(topFolderId)}` : "");
  redirect(back);
}
