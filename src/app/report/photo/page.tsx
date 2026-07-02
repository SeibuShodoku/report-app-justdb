import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PhotoReportEditor } from "@/components/photo-report-editor";
import { latestPhotoReportHref } from "@/lib/case-portal";
import { driveConfigured } from "@/lib/drive";
import { hasStoredReport, loadPhotoReportView } from "@/lib/photo-report-source";
import { loadSettings } from "@/lib/photo-report-settings-store";
import { resolveCaseAccess } from "@/lib/security/case-access";
import { iapUserEmail } from "@/lib/security/iap-user";
import { verifyLaunchToken } from "@/lib/security/launch-token";

// Drive 読み取り（node:crypto/fetch）を行うため Node ランタイム固定・毎回最新を取得。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 写真報告書ページ。
 * 起動トークン（フォルダ一致）で認可し、Drive 写真＋現在版(Supabase)をロードして
 * 編集面（クライアント島 PhotoReportEditor）に渡す。保存＝新版／版＝ロールバック。
 * 例: /report/photo?folderId=DIR&token=...
 * 直リンク入口: /report/photo?caseId=… → IAP裏で最新報告書へ解決・転送（Slack 📋ボタン）。
 */
export default async function PhotoReportPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const folderId = pickParam(sp.folderId)?.trim();
  const token = pickParam(sp.token)?.trim();
  const caseIdParam = pickParam(sp.caseId)?.trim();

  // 報告書直リンク入口（Slack 📋ボタン・暫定）: /report/photo?caseId=… のみで着地。
  // 報告書は日付フォルダ単位の管理＝「その案件の報告書」は一意でないため、IAP 裏で caseId を
  // セレクタとして**最新の報告書へ解決**し、token を採番して正規URL（folderId&token）へ転送する。
  if (!folderId && !token && caseIdParam) {
    const email = iapUserEmail(await headers());
    const access = resolveCaseAccess({ kind: "staff", email }, caseIdParam, "report-direct");
    if (!access.allowed) {
      return (
        <main>
          <section className="panel">
            <h1>写真報告書</h1>
            <p className="notice error">{access.reason}</p>
          </section>
        </main>
      );
    }
    const href = await latestPhotoReportHref(caseIdParam);
    if (href) redirect(href);
    return (
      <main>
        <section className="panel">
          <h1>写真報告書</h1>
          <p className="notice">
            この案件（<code>{caseIdParam}</code>
            ）にはまだ写真報告書がありません。Slack の案件スレッドから写真フォルダを作成し、
            写真を入れて「📝 報告書作成」を押してください。
          </p>
        </section>
      </main>
    );
  }

  // 認可：ブラウザは起動トークン必須。token.driveFolderId が folderId と一致すること。
  try {
    if (!folderId) throw new Error("folderId が必要です。");
    if (!token) throw new Error("token が必要です（起動トークン）。");
    const payload = verifyLaunchToken(token);
    if (payload.driveFolderId !== folderId) {
      throw new Error("トークンが許可するフォルダと folderId が一致しません。");
    }
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

  if (!driveConfigured()) {
    return (
      <main>
        <section className="panel">
          <h1>写真報告書</h1>
          <p className="notice error">
            Drive未設定です（.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
            GOOGLE_DRIVE_REFRESH_TOKEN）。手順: docs/spec/photo-report/slack-photo-report-impl-plan.md §1a
          </p>
        </section>
      </main>
    );
  }

  // ここまでで token は検証済み。
  const safeFolderId = folderId as string;
  const safeToken = token as string;
  const caseId = verifyLaunchToken(safeToken).caseId;

  let view;
  let settings;
  let hasReport = false;
  try {
    [view, settings, hasReport] = await Promise.all([
      loadPhotoReportView(caseId, safeFolderId),
      loadSettings(safeFolderId),
      hasStoredReport(safeFolderId)
    ]);
  } catch (error) {
    return (
      <main>
        <section className="panel">
          <h1>写真報告書</h1>
          <p className="notice error">
            写真の取得に失敗しました：
            {error instanceof Error ? error.message : "不明なエラー"}
          </p>
        </section>
      </main>
    );
  }

  // IAP の認証ユーザー（削除可否＝作成者本人かの UI 判定に使う。サーバー側でも別途強制）。
  const currentUserEmail = iapUserEmail(await headers());

  return (
    <main>
      <PhotoReportEditor
        initialView={view}
        initialSettings={settings}
        caseId={caseId}
        folderId={safeFolderId}
        token={safeToken}
        currentUserEmail={currentUserEmail ?? undefined}
        hasReport={hasReport}
      />
    </main>
  );
}
