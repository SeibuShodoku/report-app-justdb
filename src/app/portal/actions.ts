"use server";

/**
 * 案件ポータルのサーバーアクション（正本化/非正本化・並び替え）。
 * 認可は resolveCaseAccess（surface="portal"）＝ページと同じ門を通す。
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setReportCanonical, saveReportOrder } from "@/lib/case-report-index";
import { resolveCaseAccess } from "@/lib/security/case-access";
import { iapUserEmail } from "@/lib/security/iap-user";

type Gate = { caseId: string; folderId: string; topFolderId: string; email: string | null };

async function gate(formData: FormData): Promise<Gate> {
  const caseId = String(formData.get("caseId") ?? "").trim();
  const folderId = String(formData.get("folderId") ?? "").trim();
  const topFolderId = String(formData.get("topFolderId") ?? "").trim();
  const email = iapUserEmail(await headers());
  const access = resolveCaseAccess({ kind: "staff", email }, caseId, "portal");
  if (!access.allowed) throw new Error(access.reason);
  if (!folderId) throw new Error("folderId が必要です。");
  return { caseId, folderId, topFolderId, email };
}

function backTo({ caseId, topFolderId }: Gate): never {
  redirect(
    `/portal?caseId=${encodeURIComponent(caseId)}` +
      (topFolderId ? `&topFolderId=${encodeURIComponent(topFolderId)}` : "")
  );
}

/** 正本化／非正本化（canonical=1 で指定・0 で解除。複数正本可＝件ごとの判断）。 */
export async function toggleCanonicalAction(formData: FormData): Promise<void> {
  const g = await gate(formData);
  const canonical = String(formData.get("canonical") ?? "") === "1";
  await setReportCanonical(g.caseId, g.folderId, canonical, g.email);
  backTo(g);
}

/** 並び替え（↑/↓）。order＝現在の表示順（folderId の CSV・全件）を受け取り、対象を1つ動かして保存。 */
export async function moveReportAction(formData: FormData): Promise<void> {
  const g = await gate(formData);
  const dir = String(formData.get("dir") ?? "");
  const order = String(formData.get("order") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const i = order.indexOf(g.folderId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < order.length) {
    [order[i], order[j]] = [order[j], order[i]];
    await saveReportOrder(g.caseId, g.folderId, order, g.email);
  }
  backTo(g);
}
