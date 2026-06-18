import { PrintButton } from "@/components/print-button";
import { driveConfigured } from "@/lib/drive";
import { loadPhotoReportView, photoProxyUrl } from "@/lib/photo-report-source";
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
 * 写真報告書プリフィルページ。
 * 起動トークン（フォルダ一致）で認可し、Drive フォルダの写真を写真報告書として並べる。
 * 見出し・注記は当面空（Phase 2 で AI 生成 report JSON により充填）。
 * 例: /report/photo?folderId=DIR&caseId=CASE&token=...
 */
export default async function PhotoReportPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const folderId = pickParam(sp.folderId)?.trim();
  const token = pickParam(sp.token)?.trim();

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
            GOOGLE_DRIVE_REFRESH_TOKEN）。手順: docs/spec/slack-photo-report-impl-plan.md §1a
          </p>
        </section>
      </main>
    );
  }

  // ここまでで token は検証済み。
  const safeFolderId = folderId as string;
  const safeToken = token as string;

  let view;
  try {
    view = await loadPhotoReportView(verifyLaunchToken(safeToken).caseId, safeFolderId);
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

  return (
    <main>
      <section className="panel">
        <div className="inline-actions no-print">
          <h1>写真報告書</h1>
          <PrintButton />
        </div>
        <p>案件ID: {view.caseId}</p>
        {view.headerSummary ? <p>{view.headerSummary}</p> : null}
        <p>写真 {view.photoItems.length} 枚</p>

        {view.photoItems.length === 0 ? (
          <p className="notice">このフォルダに写真がありません。</p>
        ) : (
          <div className="photo-grid">
            {view.photoItems.map((item, index) => (
              <figure key={item.fileId} className="photo-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="photo-preview"
                  src={photoProxyUrl(item.fileId, safeFolderId, safeToken)}
                  alt={item.heading || item.name}
                />
                <figcaption>
                  <h3>{item.heading || `写真 ${index + 1}`}</h3>
                  {item.annotationNote ? (
                    <p>{item.annotationNote}</p>
                  ) : (
                    <p className="notice">（注記は未入力）</p>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
