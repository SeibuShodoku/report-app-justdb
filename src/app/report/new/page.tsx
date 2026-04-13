import { ReportForm } from "@/components/report-form";
import { verifyLaunchToken } from "@/lib/security/launch-token";
import { launchContextSchema } from "@/schemas/report";

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

/**
 * JUST.DB起点の報告書作成ページ。
 * URLパラメータを検証し、妥当な場合のみフォームを表示する。
 * トークン指定時のみ署名検証を行う。
 */
export default function ReportNewPage({ searchParams }: PageProps) {
  try {
    const context = launchContextSchema.parse({
      caseId: searchParams?.caseId,
      investigationId: searchParams?.investigationId,
      constructionId: searchParams?.constructionId,
      driveFolderId: searchParams?.driveFolderId,
      driveFolderUrl: searchParams?.driveFolderUrl,
      token: searchParams?.token
    });

    if (context.token) {
      const tokenPayload = verifyLaunchToken(context.token);
      if (
        tokenPayload.caseId !== context.caseId ||
        tokenPayload.investigationId !== context.investigationId ||
        tokenPayload.constructionId !== context.constructionId ||
        tokenPayload.driveFolderId !== context.driveFolderId
      ) {
        throw new Error("トークン内容とURLパラメータが一致しません。");
      }
    }

    return (
      <main>
        <section className="panel">
          <h1>報告書作成アプリ</h1>
          <p>表紙・写真報告・最終詳細の3部構成で入力します。</p>
          <p>案件ID: {context.caseId}</p>
          <ReportForm launchContext={context} />
        </section>
      </main>
    );
  } catch (error) {
    return (
      <main>
        <section className="panel">
          <h1>アクセスエラー</h1>
          <p className="notice error">
            {error instanceof Error
              ? error.message
              : "URLパラメータの検証に失敗しました。"}
          </p>
        </section>
      </main>
    );
  }
}
