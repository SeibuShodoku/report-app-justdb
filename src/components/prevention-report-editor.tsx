"use client";

/**
 * 防除作業報告書（紺谷V）の編集面（クライアント島）。
 * - フォームは `/mock` 紺谷V を流用（ヘッダ＋施工内容カスケード＋生息状況＋効果判定＋駆除作業報告）。
 * - 版UIは写真報告書（`photo-report-editor.tsx`）と同じ：保存=新版／版一覧・ロールバック・版名・削除。
 * - 「確定（公開）」で確定成果物マニフェスト（`/api/report/confirm`）へ登録＝顧客可視の起点。
 * - **使用薬剤必須**は保存時にサーバー（schema superRefine）が弾く。
 * 認可は起動トークン（folderId 一致）。IAP が「誰か」を担保。
 * 仕様: docs/spec/ring1a-prevention-report.md / docs/vision/case-portal.md §4.5
 */
import { useCallback, useEffect, useState } from "react";
import type { PreventionReportDraft } from "@/schemas/prevention-report";

type ChemicalOption = { name: string; unit: string; methods: string[] };

type WorkRow = {
  id: string;
  pest: string;
  chemical: string;
  method: string;
  amount: string;
  note: string;
  chemicalOptions: ChemicalOption[];
  methodOptions: string[];
};

type StatusRow = { pest: string; status: string };

type VersionEntry = {
  version: number;
  fileId: string;
  modifiedTime?: string;
  label?: string;
  createdBy?: string;
};

type Props = {
  folderId: string;
  token: string;
  caseId: string;
  constructionId?: string;
  initial: PreventionReportDraft | null;
  currentUserEmail?: string;
};

const EFFECT_OPTIONS = ["-", "+", "++", "+++"];

function newWorkRow(partial?: Partial<WorkRow>): WorkRow {
  return {
    id: crypto.randomUUID(),
    pest: "",
    chemical: "",
    method: "",
    amount: "",
    note: "",
    chemicalOptions: [],
    methodOptions: [],
    ...partial
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v.trim() !== "")));
}

function toWorkRows(items?: PreventionReportDraft["workItems"]): WorkRow[] {
  if (!items || items.length === 0) return [newWorkRow()];
  return items.map((w) =>
    newWorkRow({
      pest: w.pest ?? "",
      chemical: w.chemical ?? "",
      method: w.method ?? "",
      amount: w.amount ?? "",
      note: w.note ?? ""
    })
  );
}

function buildReportText(rows: WorkRow[]): string {
  const body = rows
    .filter((r) => r.pest.trim() !== "")
    .map((r) => `対象害虫/害獣：${r.pest}\n処理方法：${r.method}\n備考：${r.note}`)
    .join("\n\n");
  return `【駆除作業報告】\n${body}\n以上、施工完了しました。`;
}

export function PreventionReportEditor({
  folderId,
  token,
  caseId,
  constructionId,
  initial,
  currentUserEmail
}: Props) {
  const [customer, setCustomer] = useState(initial?.customer ?? "");
  const [reportDate, setReportDate] = useState(initial?.reportDate ?? "");
  const [site, setSite] = useState(initial?.site ?? "");
  const [manager, setManager] = useState(initial?.manager ?? "");
  const [supervisor, setSupervisor] = useState(initial?.supervisor ?? "");
  const [worker, setWorker] = useState(initial?.worker ?? "");
  const [workDate, setWorkDate] = useState(initial?.workDate ?? "");
  const [timeFrom, setTimeFrom] = useState(initial?.timeFrom ?? "");
  const [timeTo, setTimeTo] = useState(initial?.timeTo ?? "");
  const [workRows, setWorkRows] = useState<WorkRow[]>(() => toWorkRows(initial?.workItems));
  const [statusRows, setStatusRows] = useState<StatusRow[]>(() =>
    initial?.statusItems?.length
      ? initial.statusItems.map((s) => ({ pest: s.pest ?? "", status: s.status ?? "" }))
      : [{ pest: "", status: "" }]
  );
  const [effect, setEffect] = useState(initial?.effectRating ?? "");
  const [reportText, setReportText] = useState(initial?.reportText ?? "");

  const [pests, setPests] = useState<string[]>([]);
  const [masterMsg, setMasterMsg] = useState("マスタ読込中…");

  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [customerVisible, setCustomerVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 害虫マスタ（カスケード1段目）を読み込む。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/master/pests");
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setMasterMsg(`マスタ未接続: ${data.error ?? res.status}`);
          return;
        }
        setPests(data.pests ?? []);
        setMasterMsg(`マスタ接続OK（害虫 ${data.pests?.length ?? 0} 種）`);
      } catch {
        if (alive) setMasterMsg("マスタ取得に失敗しました。");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 既存版が無く施工予定IDがあれば、/api/case でケースをプリフィル（空欄のみ埋める）。
  useEffect(() => {
    if (initial || !constructionId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/case?constructionId=${encodeURIComponent(constructionId)}`);
        const data = await res.json();
        if (!alive || !res.ok) return;
        const s = data.schedule;
        if (s?.customer_name) setCustomer((c) => c || s.customer_name);
        if (s?.site) setSite((p) => p || s.site);
        if (s?.report_date) setReportDate((d) => d || String(s.report_date).slice(0, 10));
        if (s?.scheduled_at) {
          const dt = new Date(s.scheduled_at);
          setWorkDate((w) => w || dt.toISOString().slice(0, 10));
          setTimeFrom((t) => t || dt.toTimeString().slice(0, 5));
        }
      } catch {
        /* プリフィル失敗は無視（手入力できる） */
      }
    })();
    return () => {
      alive = false;
    };
  }, [initial, constructionId]);

  const patchWork = (id: string, partial: Partial<WorkRow>) =>
    setWorkRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));

  const onPestChange = async (id: string, pest: string) => {
    patchWork(id, { pest, chemical: "", method: "", chemicalOptions: [], methodOptions: [] });
    if (!pest) return;
    try {
      const res = await fetch(`/api/master/chemicals?pest=${encodeURIComponent(pest)}`);
      const data = await res.json();
      if (res.ok) patchWork(id, { chemicalOptions: data.chemicals ?? [] });
    } catch {
      /* マスタ未接続時はプルダウンが空のまま（バナーで通知） */
    }
  };

  const onChemicalChange = (id: string, chemical: string, options: ChemicalOption[]) => {
    const opt = options.find((o) => o.name === chemical);
    patchWork(id, {
      chemical,
      method: "",
      methodOptions: opt?.methods ?? [],
      amount: opt?.unit ? `0${opt.unit}` : ""
    });
  };

  const addWork = () => setWorkRows((prev) => [...prev, newWorkRow()]);
  const removeWork = (id: string) => setWorkRows((prev) => prev.filter((r) => r.id !== id));

  const updateStatus = (i: number, key: keyof StatusRow, value: string) =>
    setStatusRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const addStatus = () => setStatusRows((prev) => [...prev, { pest: "", status: "" }]);
  const removeStatus = (i: number) => setStatusRows((prev) => prev.filter((_, idx) => idx !== i));

  const buildReport = useCallback(
    (): PreventionReportDraft => ({
      caseId,
      constructionId: constructionId || undefined,
      driveFolderId: folderId,
      reportDate: reportDate || undefined,
      customer: customer || undefined,
      site: site || undefined,
      manager: manager || undefined,
      supervisor: supervisor || undefined,
      worker: worker || undefined,
      workDate: workDate || undefined,
      timeFrom: timeFrom || undefined,
      timeTo: timeTo || undefined,
      workItems: workRows
        .filter((r) => r.pest.trim() || r.chemical.trim() || r.method.trim())
        .map((r) => ({
          id: r.id,
          pest: r.pest,
          chemical: r.chemical,
          method: r.method,
          amount: r.amount,
          note: r.note || undefined
        })),
      reportText: reportText || undefined,
      statusItems: statusRows
        .filter((r) => r.pest.trim() || r.status.trim())
        .map((r) => ({ pest: r.pest, status: r.status })),
      effectRating: effect || undefined
    }),
    [
      caseId,
      constructionId,
      folderId,
      reportDate,
      customer,
      site,
      manager,
      supervisor,
      worker,
      workDate,
      timeFrom,
      timeTo,
      workRows,
      reportText,
      statusRows,
      effect
    ]
  );

  const refreshVersions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/prevention-report/versions?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `版一覧の取得に失敗（${res.status}）`);
      setVersions(json.versions ?? []);
    } catch (e) {
      setVersions([]);
      setMessage({ type: "error", text: e instanceof Error ? e.message : "版一覧の取得に失敗しました。" });
    }
  }, [folderId, token]);

  const toggleVersions = useCallback(() => {
    const open = !versionsOpen;
    setVersionsOpen(open);
    if (open) {
      setVersions(null);
      void refreshVersions();
    }
  }, [versionsOpen, refreshVersions]);

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/prevention-report/save?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report: buildReport(), label: saveLabel.trim() || undefined })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `保存に失敗（${res.status}）`);
      setMessage({
        type: "success",
        text: `保存しました（v${json.version}${saveLabel.trim() ? `「${saveLabel.trim()}」` : ""}）。`
      });
      setSaveLabel("");
      if (versionsOpen) void refreshVersions();
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "保存に失敗しました。" });
    } finally {
      setSaving(false);
    }
  }, [folderId, token, buildReport, saveLabel, versionsOpen, refreshVersions]);

  const confirmReport = useCallback(async () => {
    if (
      !window.confirm(
        customerVisible
          ? "最新版を確定し、顧客提示に公開します。よろしいですか？"
          : "最新版を確定（社内）します。よろしいですか？"
      )
    ) {
      return;
    }
    setConfirming(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/report/confirm?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reportType: "prevention",
            stage: "construction",
            title: `防除作業報告書${customer ? `（${customer}）` : ""}`,
            customerVisible
          })
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `確定に失敗（${res.status}）`);
      setMessage({
        type: "success",
        text: `確定しました（v${json.version}・${customerVisible ? "顧客公開" : "社内"}）。`
      });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "確定に失敗しました。" });
    } finally {
      setConfirming(false);
    }
  }, [folderId, token, customer, customerVisible]);

  const renameVersion = useCallback(
    async (version: number, current: string) => {
      const label = window.prompt(`v${version} の版名`, current);
      if (label === null) return;
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/prevention-report/rename?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version, label })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `版名の更新に失敗（${res.status}）`);
        await refreshVersions();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "版名の更新に失敗しました。" });
      } finally {
        setBusyVersion(null);
      }
    },
    [folderId, token, refreshVersions]
  );

  const deleteVersion = useCallback(
    async (version: number) => {
      if (!window.confirm(`v${version} を削除します（Drive のゴミ箱へ移動・復元可）。よろしいですか？`)) {
        return;
      }
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/prevention-report/delete?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `削除に失敗（${res.status}）`);
        await refreshVersions();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "削除に失敗しました。" });
      } finally {
        setBusyVersion(null);
      }
    },
    [folderId, token, refreshVersions]
  );

  const rollback = useCallback(
    async (version: number) => {
      if (!window.confirm(`v${version} の内容で新しい版を作成して現在版に戻します。よろしいですか？`)) {
        return;
      }
      setBusyVersion(version);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/prevention-report/rollback?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version })
          }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `ロールバックに失敗（${res.status}）`);
        window.location.reload();
      } catch (e) {
        setMessage({ type: "error", text: e instanceof Error ? e.message : "ロールバックに失敗しました。" });
        setBusyVersion(null);
      }
    },
    [folderId, token]
  );

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>

      <div className="mk-chrome mk-toolbar">
        <div className="mk-brand">
          <strong>防除作業報告書（紺谷V）</strong>
          <span className="mk-hint">案件ID: {caseId}</span>
        </div>
        <div className="mk-tabs">
          <input
            type="text"
            className="mk-version-label"
            value={saveLabel}
            maxLength={200}
            placeholder="版名（任意）"
            onChange={(e) => setSaveLabel(e.target.value)}
          />
          <button type="button" className="mk-print" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存（新しい版）"}
          </button>
          <button type="button" className="mk-tab" onClick={toggleVersions}>
            {versionsOpen ? "版を閉じる" : "版を表示"}
          </button>
          <label className="mk-pub">
            <input
              type="checkbox"
              checked={customerVisible}
              onChange={(e) => setCustomerVisible(e.target.checked)}
            />
            顧客公開
          </label>
          <button type="button" className="mk-tab" onClick={confirmReport} disabled={confirming}>
            {confirming ? "確定中…" : "確定（公開）"}
          </button>
          <button type="button" className="mk-print" onClick={() => window.print()}>
            🖨 印刷 / PDF
          </button>
        </div>
      </div>

      {message ? (
        <p className={`mk-chrome mk-msg ${message.type}`} role="status">
          {message.text}
        </p>
      ) : null}

      {versionsOpen ? (
        <div className="mk-chrome mk-versions">
          <strong>版履歴（新しい順）</strong>
          {versions === null ? (
            <p className="mk-hint">読み込み中…</p>
          ) : versions.length === 0 ? (
            <p className="mk-hint">まだ保存された版はありません（保存すると v0001 から記録されます）。</p>
          ) : (
            <ul className="mk-version-list">
              {versions.map((v, vi) => {
                const isLatest = vi === 0;
                const notOwner = Boolean(
                  v.createdBy && currentUserEmail && v.createdBy !== currentUserEmail
                );
                const deleteDisabled = busyVersion !== null || isLatest || notOwner;
                return (
                  <li key={v.version}>
                    <span>
                      v{v.version}
                      {isLatest ? "（現在版）" : ""}
                      {v.label ? `・${v.label}` : ""}
                      {v.createdBy ? `・${v.createdBy}` : ""}
                      {v.modifiedTime ? `・${new Date(v.modifiedTime).toLocaleString("ja-JP")}` : ""}
                    </span>
                    <span className="mk-version-actions">
                      <button type="button" onClick={() => renameVersion(v.version, v.label ?? "")} disabled={busyVersion !== null}>
                        名前
                      </button>
                      <button type="button" onClick={() => rollback(v.version)} disabled={busyVersion !== null}>
                        {busyVersion === v.version ? "処理中…" : "この版に戻す"}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteVersion(v.version)}
                        disabled={deleteDisabled}
                        title={isLatest ? "最新版は削除不可（先に別版へ戻す）" : notOwner ? `作成者（${v.createdBy}）のみ削除可` : "Drive ゴミ箱へ（復元可）"}
                      >
                        削除
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mk-stage">
        <div className="mk-sheet">
          <div className="mk-legal">
            「ビル管理法」・「食品衛生法」・「労働安全衛生法」に定める備付帳簿用
          </div>
          <div className="mk-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mk-logo" src="/seibu-joto-logo.jpg" alt="西武消毒株式会社 城東支店" />
            <div className="mk-title">防 除 作 業 完 了 報 告 書</div>
            <div className="mk-copy">お客様控</div>
          </div>

          <div className="mk-to-line">
            <input className="mk-fill" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="顧客名" />
            <span>御中</span>
            <input className="mk-date" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </div>

          <div className="mk-resp">
            <label>管理責任者<input value={manager} onChange={(e) => setManager(e.target.value)} /></label>
            <label>作業責任者<input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} /></label>
            <label>作業員<input value={worker} onChange={(e) => setWorker(e.target.value)} /></label>
          </div>

          <p className="mk-greet">
            毎度お引立に預り有難うございます。下記の通り作業完了いたしましたので結果と共に報告いたします。
          </p>

          <div className="mk-kv">
            <span className="mk-kv-label">施 工 日 時</span>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            <span className="mk-kv-sub">作業時間</span>
            <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
            <span>～</span>
            <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </div>
          <div className="mk-kv">
            <span className="mk-kv-label">施 工 場 所</span>
            <input className="mk-fill" value={site} onChange={(e) => setSite(e.target.value)} placeholder="施工場所/物件名" />
          </div>

          <div className="mk-section-label">施 工 内 容（害虫→薬剤→処理方法のカスケード・使用薬剤必須）</div>
          <table className="mk-table">
            <thead>
              <tr>
                <th>対象害虫</th>
                <th>使用薬剤</th>
                <th>処理方法</th>
                <th>薬剤使用量</th>
                <th>備考</th>
                <th className="mk-op" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {workRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <select value={r.pest} onChange={(e) => onPestChange(r.id, e.target.value)}>
                      <option value="">選択…</option>
                      {uniq([r.pest, ...pests]).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={r.chemical}
                      disabled={!r.pest}
                      onChange={(e) => onChemicalChange(r.id, e.target.value, r.chemicalOptions)}
                    >
                      <option value="">選択…</option>
                      {uniq([r.chemical, ...r.chemicalOptions.map((o) => o.name)]).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={r.method}
                      disabled={!r.chemical}
                      onChange={(e) => patchWork(r.id, { method: e.target.value })}
                    >
                      <option value="">選択…</option>
                      {uniq([r.method, ...r.methodOptions]).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>
                  <td><input value={r.amount} onChange={(e) => patchWork(r.id, { amount: e.target.value })} /></td>
                  <td><input value={r.note} onChange={(e) => patchWork(r.id, { note: e.target.value })} /></td>
                  <td className="mk-op">
                    <button type="button" className="mk-ghost" onClick={() => removeWork(r.id)} aria-label="行を削除">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mk-row-actions">
            <button type="button" className="mk-ghost" onClick={addWork}>＋ 薬剤の行を追加</button>
            <span className="mk-hint mk-chrome">{masterMsg}</span>
          </div>

          <div className="mk-section-label">駆除作業報告（施工内容から自動生成・編集可）</div>
          <div className="mk-row-actions mk-chrome">
            <button type="button" className="mk-ghost" onClick={() => setReportText(buildReportText(workRows))}>
              ↻ 施工内容から自動生成
            </button>
          </div>
          <textarea className="mk-report" value={reportText} onChange={(e) => setReportText(e.target.value)} />

          <div className="mk-section-label">生 息 状 況</div>
          <table className="mk-table mk-table-2">
            <thead>
              <tr>
                <th>対象</th>
                <th>状況</th>
                <th className="mk-op" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {statusRows.map((r, i) => (
                <tr key={`s-${i}`}>
                  <td><input value={r.pest} onChange={(e) => updateStatus(i, "pest", e.target.value)} /></td>
                  <td><input value={r.status} onChange={(e) => updateStatus(i, "status", e.target.value)} /></td>
                  <td className="mk-op">
                    <button type="button" className="mk-ghost" onClick={() => removeStatus(i)} aria-label="行を削除">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mk-row-actions">
            <button type="button" className="mk-ghost" onClick={addStatus}>＋ 生息状況の行を追加</button>
          </div>

          <div className="mk-effect">
            <span className="mk-kv-label">効果判定</span>
            {EFFECT_OPTIONS.map((opt) => (
              <label key={opt} className="mk-radio">
                <input type="radio" name="effect" checked={effect === opt} onChange={() => setEffect(opt)} />
                {opt}
              </label>
            ))}
          </div>

          <p className="mk-foot">上記の通り実施いたしました。</p>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.mk-wrap { max-width: 920px; margin: 0 auto; padding: 16px; }
.mk-toolbar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between;
  align-items: center; gap: 12px; flex-wrap: wrap; background: #0f766e; color: #fff;
  padding: 10px 14px; border-radius: 12px; margin-bottom: 10px; }
.mk-brand { display: flex; flex-direction: column; }
.mk-brand .mk-hint { color: #d1fae5; font-size: 0.78rem; }
.mk-tabs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mk-tab { background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.4);
  border-radius: 999px; padding: 8px 16px; font-weight: 700; cursor: pointer; }
.mk-print { background: #f59e0b; color: #1f2937; border: none; border-radius: 999px;
  padding: 8px 14px; font-weight: 700; cursor: pointer; }
.mk-print:disabled, .mk-tab:disabled { opacity: 0.6; cursor: default; }
.mk-version-label { width: 140px; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.5); }
.mk-pub { display: flex; align-items: center; gap: 4px; font-weight: 700; font-size: 0.85rem; }
.mk-pub input { width: auto; }

.mk-msg { padding: 8px 12px; border-radius: 8px; margin: 0 0 10px; font-weight: 600; }
.mk-msg.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.mk-msg.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

.mk-versions { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
.mk-version-list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.mk-version-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px;
  flex-wrap: wrap; font-size: 0.85rem; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px; }
.mk-version-actions { display: flex; gap: 6px; }
.mk-version-actions button { background: #fff; color: #0f766e; border: 1px solid #0f766e; border-radius: 6px;
  padding: 4px 10px; font-weight: 700; cursor: pointer; }
.mk-version-actions button:disabled { opacity: 0.5; cursor: default; }

.mk-stage { display: grid; gap: 20px; }
.mk-sheet { background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 22px 26px; color: #111827; box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
.mk-legal { font-size: 0.72rem; color: #6b7280; border: 1px solid #e5e7eb; display: inline-block;
  padding: 2px 8px; border-radius: 4px; margin-bottom: 10px; }
.mk-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 12px; }
.mk-logo { height: 46px; width: auto; }
.mk-title { text-align: center; font-size: 1.45rem; font-weight: 800; letter-spacing: 2px; }
.mk-copy { border: 1px solid #111827; padding: 2px 8px; font-size: 0.8rem; border-radius: 4px; }

.mk-to-line { display: flex; align-items: center; gap: 8px; margin: 6px 0 12px; }
.mk-to-line .mk-fill { font-size: 1.1rem; font-weight: 700; }
.mk-date { margin-left: auto; max-width: 170px; }

.mk-resp { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 10px; }
.mk-resp label { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.88rem; }
.mk-resp input { width: 130px; }

.mk-greet { color: #374151; margin: 8px 0 14px; font-size: 0.92rem; }

.mk-kv { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0; }
.mk-kv-label { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 4px 10px; font-weight: 700;
  font-size: 0.85rem; border-radius: 4px; min-width: 96px; text-align: center; }
.mk-kv-sub { font-size: 0.85rem; color: #6b7280; }
.mk-kv input[type="date"], .mk-kv input[type="time"] { width: auto; }
.mk-kv .mk-fill { flex: 1; }

.mk-section-label { background: #0f766e; color: #fff; font-weight: 700; font-size: 0.9rem;
  padding: 6px 10px; border-radius: 4px; margin: 16px 0 8px; }

.mk-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.mk-table th, .mk-table td { border: 1px solid #cbd5e1; padding: 0; }
.mk-table th { background: #f1f5f9; padding: 6px 4px; font-weight: 700; }
.mk-table td input, .mk-table td select { border: none; border-radius: 0; background: transparent; padding: 8px 6px; width: 100%; }
.mk-table td input:focus, .mk-table td select:focus { outline: 2px solid #0f766e; outline-offset: -2px; }
.mk-table td select:disabled { color: #9ca3af; }
.mk-table .mk-op { width: 34px; text-align: center; }
.mk-table .mk-op .mk-ghost { padding: 4px 6px; }
.mk-table-2 th:first-child, .mk-table-2 td:first-child { width: 40%; }

.mk-row-actions { margin: 8px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mk-ghost { background: #fff; color: #0f766e; border: 1px dashed #0f766e; border-radius: 8px;
  padding: 6px 12px; font-weight: 700; cursor: pointer; width: auto; }
.mk-report { width: 100%; min-height: 120px; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 10px; font: inherit; white-space: pre-wrap; }

.mk-effect { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.mk-radio { display: flex; align-items: center; gap: 4px; font-weight: 700; }
.mk-radio input { width: auto; }
.mk-foot { text-align: center; margin-top: 18px; font-weight: 700; color: #111827; }
.mk-hint { color: #6b7280; font-size: 0.85rem; }

input, textarea, button, select { font: inherit; }
.mk-sheet input, .mk-sheet textarea { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; width: 100%; background: #fff; }

@media (max-width: 760px) {
  .mk-resp input { width: 100px; }
}

@media print {
  .mk-chrome { display: none !important; }
  .mk-wrap { max-width: none; padding: 0; }
  .mk-sheet { border: none; box-shadow: none; border-radius: 0; padding: 0; }
  .mk-stage { gap: 0; }
  body { background: #fff; }
}
`;
