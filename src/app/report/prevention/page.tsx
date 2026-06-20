import { headers } from "next/headers";
import { PreventionReportEditor } from "@/components/prevention-report-editor";
import { driveWriteConfigured } from "@/lib/drive-write";
import { loadCurrentPreventionReport } from "@/lib/prevention-report-store";
import { iapUserEmail } from "@/lib/security/iap-user";
import { verifyLaunchToken } from "@/lib/security/launch-token";

// Drive 書込み（RW）・node:crypto を行うため Node ランタイム固定・毎回最新を取得。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 防除作業報告書（紺谷V）ページ。
 * 起動トークン（フォルダ一致）で認可し、Supabase 現在版をロードして編集面
 * （クライアント島 PreventionReportEditor）に渡す。保存＝新版／確定＝マニフェスト登録。
 * 例: /report/prevention?folderId=DIR&token=...
 */
export default async function PreventionReportPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const folderId = pickParam(sp.folderId)?.trim();
  const token = pickParam(sp.token)?.trim();

  let caseId: string;
  let constructionId: string | undefined;
  try {
    if (!folderId) throw new Error("folderId が必要です。");
    if (!token) throw new Error("token が必要です（起動トークン）。");
    const payload = verifyLaunchToken(token);
    if (payload.driveFolderId !== folderId) {
      throw new Error("トークンが許可するフォルダと folderId が一致しません。");
    }
    caseId = payload.caseId;
    constructionId = payload.constructionId;
  } catch (error) {
    return (
      <main>
        <section className="panel">
          <h1>アクセスエラー</h1>
          <p className="notice error">
            {error instanceof Error ? error.message : "アクセス検証に失敗しました。"}
          </p>
        </section>
      </main>
    );
  }

  if (!driveWriteConfigured()) {
    return (
      <main>
        <section className="panel">
          <h1>防除作業報告書</h1>
          <p className="notice error">
            Drive未設定です（.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
            GOOGLE_DRIVE_REFRESH_TOKEN）。
          </p>
        </section>
      </main>
    );
  }

  const safeFolderId = folderId as string;
  const safeToken = token as string;
  const initial = await loadCurrentPreventionReport(safeFolderId);
  const currentUserEmail = iapUserEmail(await headers());

  return (
    <main>
      <PreventionReportEditor
        folderId={safeFolderId}
        token={safeToken}
        caseId={caseId}
        constructionId={constructionId}
        initial={initial}
        currentUserEmail={currentUserEmail ?? undefined}
      />
    </main>
  );
}
