import { headers } from "next/headers";
import Link from "next/link";
import { iapUserEmail } from "@/lib/security/iap-user";
import { resolveCaseAccess } from "@/lib/security/case-access";
import { loadCasePortal, type PortalReport } from "@/lib/case-portal";
import type { DeliverableEntry } from "@/lib/case-deliverables";

// Drive/Supabase 読取・node:crypto（token 採番）を行うため Node ランタイム固定・毎回最新。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** ISO時刻を JST の "YYYY-MM-DD HH:mm" に。失敗時は日付だけ／空。 */
function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso)
      .toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
      .replace(/\//g, "-");
  } catch {
    return iso.slice(0, 10);
  }
}

function ReportRow({ label, icon, r }: { label: string; icon: string; r: PortalReport }) {
  const when = fmt(r.generatedAt);
  return (
    <li className="portal-row">
      <Link href={r.href} className="portal-link">
        <span className="portal-ic" aria-hidden>
          {icon}
        </span>
        <span className="portal-body">
          <span className="portal-title">{label}</span>
          <span className="portal-sub">
            {when ? `最終更新 ${when}` : "更新日時なし"} ・ 編集面を開く
          </span>
        </span>
        <span className="portal-chev" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  );
}

/**
 * 案件ポータル（総合窓口・社内/IAP）。Slack の案件トピックからは固定リンク
 * `/portal?caseId=…` で入る（URL発行＝launch token とは別経路）。
 *
 * 認可は必ず `resolveCaseAccess` を通す（caseId はセレクタ・門は IAP）。裏＝全成果物、
 * 表（将来）＝確定・顧客可視のみ。仕様: docs/vision/case-portal.md §4・§8。
 */
export default async function CasePortalPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const caseId = pickParam(sp.caseId)?.trim();

  if (!caseId) {
    return (
      <main>
        <section className="panel">
          <h1>案件ポータル</h1>
          <p className="notice">
            案件IDが必要です。Slack の案件トピックの固定リンク（
            <code>/portal?caseId=…</code>）からアクセスしてください。
          </p>
        </section>
      </main>
    );
  }

  const email = iapUserEmail(await headers());
  const access = resolveCaseAccess({ kind: "staff", email }, caseId);
  if (!access.allowed) {
    return (
      <main>
        <section className="panel">
          <h1>案件ポータル</h1>
          <p className="notice error">{access.reason}</p>
        </section>
      </main>
    );
  }

  let portal: Awaited<ReturnType<typeof loadCasePortal>> | null = null;
  let loadError: string | null = null;
  try {
    portal = await loadCasePortal(caseId, access.scope);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "案件データの取得に失敗しました。";
  }

  const hasAny =
    !!portal &&
    (portal.photoReports.length > 0 ||
      portal.preventionReports.length > 0 ||
      portal.confirmed.length > 0);

  return (
    <main>
      <section className="panel portal">
        <header className="portal-head">
          <h1>案件ポータル</h1>
          <p className="portal-caseid">
            案件ID <code>{caseId}</code>
          </p>
        </header>

        {loadError && <p className="notice error">{loadError}</p>}
        {portal && !portal.supabaseReady && (
          <p className="notice">Supabase 未設定のため成果物の一覧は表示できません（ローカル開発）。</p>
        )}

        {portal && (
          <>
            <section className="portal-group">
              <h2 className="portal-group-h">📷 写真報告書</h2>
              {portal.photoReports.length > 0 ? (
                <ul className="portal-list">
                  {portal.photoReports.map((r) => (
                    <ReportRow key={r.folderId} label="写真報告書" icon="📷" r={r} />
                  ))}
                </ul>
              ) : (
                <p className="portal-empty">まだありません。</p>
              )}
            </section>

            <section className="portal-group">
              <h2 className="portal-group-h">🧪 防除作業報告書</h2>
              {portal.preventionReports.length > 0 ? (
                <ul className="portal-list">
                  {portal.preventionReports.map((r) => (
                    <ReportRow key={r.folderId} label="防除作業報告書" icon="🧪" r={r} />
                  ))}
                </ul>
              ) : (
                <p className="portal-empty">まだありません。</p>
              )}
            </section>

            <section className="portal-group">
              <h2 className="portal-group-h">💴 見積書</h2>
              {portal.estimateHref ? (
                <ul className="portal-list">
                  <li className="portal-row">
                    <Link href={portal.estimateHref} className="portal-link">
                      <span className="portal-ic" aria-hidden>
                        💴
                      </span>
                      <span className="portal-body">
                        <span className="portal-title">
                          見積作成 <span className="portal-tag">試作</span>
                        </span>
                        <span className="portal-sub">原価積算・ライブ計算（案件束縛は配線中）</span>
                      </span>
                      <span className="portal-chev" aria-hidden>
                        ›
                      </span>
                    </Link>
                  </li>
                </ul>
              ) : (
                <p className="portal-empty">—</p>
              )}
            </section>

            {portal.confirmed.length > 0 && (
              <section className="portal-group">
                <h2 className="portal-group-h">✅ 確定済成果物</h2>
                <ul className="portal-list">
                  {portal.confirmed.map((d: DeliverableEntry) => (
                    <li key={d.deliverable_id} className="portal-row portal-row--static">
                      <span className="portal-ic" aria-hidden>
                        ✅
                      </span>
                      <span className="portal-body">
                        <span className="portal-title">
                          {d.title || (d.report_type === "photo" ? "写真報告書" : "防除作業報告書")}{" "}
                          <span className="portal-tag">v{d.version}</span>
                          {d.customer_visible && <span className="portal-tag portal-tag--ok">顧客可視</span>}
                        </span>
                        <span className="portal-sub">
                          確定 {fmt(d.confirmed_at)}
                          {" ・ 顧客提示URLの発行はリング1cで配線"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!hasAny && portal.supabaseReady && (
              <p className="notice">
                この案件にはまだ成果物がありません。新規の写真報告書は Slack
                の案件スレッドから写真を投稿して開始します。
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
