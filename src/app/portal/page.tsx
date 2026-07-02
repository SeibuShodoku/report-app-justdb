import { headers } from "next/headers";
import Link from "next/link";
import { iapUserEmail } from "@/lib/security/iap-user";
import { resolveCaseAccess } from "@/lib/security/case-access";
import { loadCasePortal, type PortalReport } from "@/lib/case-portal";
import type { DeliverableEntry } from "@/lib/case-deliverables";
import { moveReportAction, toggleCanonicalAction } from "./actions";

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

/** 行タイトル＝種類ラベル（⚙️設定の 調査/施工）。未設定は素の「写真報告書」。 */
function kindLabel(r: PortalReport): string {
  if (r.kind === "survey") return "調査写真報告書";
  if (r.kind === "construction") return "施工写真報告書";
  return "写真報告書";
}

function ReportRow({
  r,
  caseId,
  topFolderId,
  orderCsv,
  isFirst,
  isLast
}: {
  r: PortalReport;
  caseId: string;
  topFolderId: string | null;
  orderCsv: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const when = fmt(r.generatedAt);
  const common = (
    <>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="folderId" value={r.folderId} />
      <input type="hidden" name="topFolderId" value={topFolderId ?? ""} />
    </>
  );
  return (
    <li className="portal-row">
      <Link href={r.href} className="portal-link">
        <span className="portal-ic" aria-hidden>
          {r.kind === "survey" ? "🔍" : "📷"}
        </span>
        <span className="portal-body">
          <span className="portal-title">
            {kindLabel(r)}
            {r.isCanonical && <span className="portal-tag portal-tag--ok">正本</span>}
          </span>
          <span className="portal-sub">
            {r.folderName ?? `…${r.folderId.slice(-6)}`}
            {when ? ` ・ 最終更新 ${when}` : ""}
          </span>
        </span>
        <span className="portal-chev" aria-hidden>
          ›
        </span>
      </Link>
      <span className="portal-aside">
        <form action={moveReportAction}>
          {common}
          <input type="hidden" name="dir" value="up" />
          <input type="hidden" name="order" value={orderCsv} />
          <button type="submit" className="portal-side-btn" disabled={isFirst} title="上へ">
            ↑
          </button>
        </form>
        <form action={moveReportAction}>
          {common}
          <input type="hidden" name="dir" value="down" />
          <input type="hidden" name="order" value={orderCsv} />
          <button type="submit" className="portal-side-btn" disabled={isLast} title="下へ">
            ↓
          </button>
        </form>
        <form action={toggleCanonicalAction}>
          {common}
          <input type="hidden" name="canonical" value={r.isCanonical ? "0" : "1"} />
          <button
            type="submit"
            className={`portal-side-btn${r.isCanonical ? " portal-side-btn--on" : ""}`}
            title={
              r.isCanonical
                ? "正本を解除する"
                : "正本にする（顧客に届ける正・AIが次回参照する基準。複数指定可）"
            }
          >
            {r.isCanonical ? "正本解除" : "正本にする"}
          </button>
        </form>
      </span>
    </li>
  );
}

/**
 * 案件ポータル（総合窓口・社内/IAP）＝**写真報告書の管理面**。
 * Slack の案件トピックの「📋 報告書」固定リンク `/portal?caseId=…&topFolderId=…` で入る。
 *
 * 案件は時系列で進む（調査 → 調査報告書/見積 → 施工×n → 施工報告書）：
 * - 一覧＝種類ラベル（調査/施工＝編集面⚙️設定の report_type）付きで**時系列（作成順）に1列**。
 *   ↑↓で手動並び替え（`_ai/report-index.json` に保存）。
 * - **正本**＝件（調査・施工の1回）ごとに「顧客に届ける正」を指定。**複数指定可・解除可**。
 *   AI が次の報告書を作る時に正本（複数）を参照＝どれを読むべきか迷わない。
 * - 新規作成＝本日分の日付フォルダを find-or-create してサイト内アップロードへ。
 *
 * 認可は必ず `resolveCaseAccess` を通す（caseId はセレクタ・門は IAP＋試験運用 allowlist）。
 * 仕様: docs/vision/case-portal.md §7.5。
 */
export default async function CasePortalPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const caseId = pickParam(sp.caseId)?.trim();
  const topFolderIdParam = pickParam(sp.topFolderId)?.trim() || null;

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
  const access = resolveCaseAccess({ kind: "staff", email }, caseId, "portal");
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
    portal = await loadCasePortal(caseId, access.scope, topFolderIdParam);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "案件データの取得に失敗しました。";
  }

  const topFolderId = portal?.caseFolderId ?? topFolderIdParam;
  const newReportHref = topFolderId
    ? `/report/photo?caseId=${encodeURIComponent(caseId)}&topFolderId=${encodeURIComponent(topFolderId)}&new=1`
    : null;
  const orderCsv = (portal?.photoReports ?? []).map((r) => r.folderId).join(",");
  const hasCanonical = (portal?.photoReports ?? []).some((r) => r.isCanonical);

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
              <h2 className="portal-group-h">📷 写真報告書（時系列）</h2>
              {portal.photoReports.length > 0 ? (
                <>
                  <ul className="portal-list">
                    {portal.photoReports.map((r, i) => (
                      <ReportRow
                        key={r.folderId}
                        r={r}
                        caseId={caseId}
                        topFolderId={topFolderId}
                        orderCsv={orderCsv}
                        isFirst={i === 0}
                        isLast={i === portal!.photoReports.length - 1}
                      />
                    ))}
                  </ul>
                  {!hasCanonical && portal.photoReports.length > 0 && (
                    <p className="portal-hint">
                      正本が未指定です。顧客に届ける報告書を「正本にする」で指定すると、AI
                      が次の報告書を作る時にそれを参照します（調査・施工それぞれに指定できます）。
                    </p>
                  )}
                </>
              ) : (
                <p className="portal-empty">まだありません。下の「新規作成」から始められます。</p>
              )}
            </section>

            <section className="portal-group">
              <h2 className="portal-group-h">➕ 新規作成</h2>
              {newReportHref ? (
                <ul className="portal-list">
                  <li className="portal-row">
                    <Link href={newReportHref} className="portal-link">
                      <span className="portal-ic" aria-hidden>
                        📸
                      </span>
                      <span className="portal-body">
                        <span className="portal-title">本日分の写真報告書を作成</span>
                        <span className="portal-sub">
                          写真_本日 フォルダを用意 → サイト上で写真を取り込み、⚙️設定で
                          調査/施工を選んで AI 作成
                        </span>
                      </span>
                      <span className="portal-chev" aria-hidden>
                        ›
                      </span>
                    </Link>
                  </li>
                </ul>
              ) : (
                <p className="portal-empty">
                  案件フォルダが特定できないため新規作成できません。Slack の「📋 報告書」ボタンから
                  開き直してください。
                </p>
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
                          {d.title || "写真報告書"} <span className="portal-tag">v{d.version}</span>
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
          </>
        )}
      </section>
    </main>
  );
}
