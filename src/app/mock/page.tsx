"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 防除作業完了報告書モック。
 * 同じ入力データから、タブ切り替えで「紺谷V」「写真報告書」「融合」を生成する。
 * 統合の手前——各バージョンを俎上に乗せて議論するための「まな板」。
 *
 * JUST.DB連携:
 *  - ケースデータ（顧客名/施工先/施工日時/報告日）は施工予定IDで取得。
 *  - 施工内容は 害虫→薬剤→処理方法 のカスケード（JUST.DB薬剤資材のSupabaseミラー）。
 */

type TabKey = "kanya" | "photo" | "fusion";

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

type Photo = { id: string; url: string; heading: string; note: string };

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

function buildReportText(rows: WorkRow[]): string {
  const body = rows
    .filter((r) => r.pest.trim() !== "")
    .map((r) => `対象害虫/害獣：${r.pest}\n処理方法：${r.method}\n備考：${r.note}`)
    .join("\n\n");
  return `【駆除作業報告】\n${body}\n以上、施工完了しました。`;
}

const INITIAL_WORK: WorkRow[] = [
  newWorkRow({
    pest: "ネズミ",
    chemical: "クマリン系粉剤",
    method: "交換",
    amount: "100g",
    note: "薬剤喫食なし"
  })
];

const INITIAL_STATUS: StatusRow[] = [{ pest: "ネズミ", status: "－" }];

export default function MockPage() {
  const [tab, setTab] = useState<TabKey>("kanya");

  const [constructionId, setConstructionId] = useState("CONST001");
  const [caseId, setCaseId] = useState("");
  const [caseMsg, setCaseMsg] = useState("");

  const [customer, setCustomer] = useState("心行寺");
  const [reportDate, setReportDate] = useState("2026-03-01");
  const [manager, setManager] = useState("杉山　豊");
  const [supervisor, setSupervisor] = useState("紺谷直人");
  const [worker, setWorker] = useState("");
  const [workDate, setWorkDate] = useState("2026-03-01");
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("10:00");
  const [place, setPlace] = useState("江東区南砂");

  const [workRows, setWorkRows] = useState<WorkRow[]>(INITIAL_WORK);
  const [statusRows, setStatusRows] = useState<StatusRow[]>(INITIAL_STATUS);
  const [effect, setEffect] = useState("-");
  const [reportText, setReportText] = useState(() => buildReportText(INITIAL_WORK));
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [pests, setPests] = useState<string[]>([]);
  const [masterMsg, setMasterMsg] = useState("マスタ読込中…");

  const fileRef = useRef<HTMLInputElement | null>(null);

  // 害虫マスタ（カスケード1段目）を読み込む
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
  const removeWork = (id: string) =>
    setWorkRows((prev) => prev.filter((r) => r.id !== id));

  const updateStatus = (i: number, key: keyof StatusRow, value: string) =>
    setStatusRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const addStatus = () => setStatusRows((prev) => [...prev, { pest: "", status: "" }]);
  const removeStatus = (i: number) =>
    setStatusRows((prev) => prev.filter((_, idx) => idx !== i));

  const fetchCase = async () => {
    setCaseMsg("取得中…");
    try {
      const res = await fetch(`/api/case?constructionId=${encodeURIComponent(constructionId)}`);
      const data = await res.json();
      if (!res.ok) {
        setCaseMsg(`取得失敗: ${data.error ?? res.status}`);
        return;
      }
      const s = data.schedule;
      setCaseId(s.case_id ?? "");
      if (s.customer_name) setCustomer(s.customer_name);
      if (s.site) setPlace(s.site);
      if (s.report_date) setReportDate(String(s.report_date).slice(0, 10));
      if (s.scheduled_at) {
        const d = new Date(s.scheduled_at);
        setWorkDate(d.toISOString().slice(0, 10));
        setTimeFrom(d.toTimeString().slice(0, 5));
      }
      setCaseMsg(`取得OK（案件ID: ${s.case_id ?? "—"} ／ 受注ID: ${s.order_id ?? "—"}）`);
    } catch {
      setCaseMsg("取得に失敗しました。");
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const next: Photo[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ id: crypto.randomUUID(), url: URL.createObjectURL(f), heading: f.name, note: "" }));
    setPhotos((prev) => [...prev, ...next]);
  };
  const updatePhoto = (id: string, key: keyof Photo, value: string) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
  const removePhoto = (id: string) =>
    setPhotos((prev) => prev.filter((p) => p.id !== id));

  const renderKanya = () => (
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
        <input className="mk-fill" value={customer} onChange={(e) => setCustomer(e.target.value)} />
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
        <input className="mk-fill" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>

      <div className="mk-section-label">施 工 内 容（害虫→薬剤→処理方法のカスケード）</div>
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
  );

  const renderPhotos = (showHeader: boolean) => (
    <div className="mk-sheet">
      {showHeader ? (
        <div className="mk-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mk-logo" src="/seibu-joto-logo.jpg" alt="西武消毒株式会社 城東支店" />
          <div className="mk-title">写 真 報 告 書</div>
          <div className="mk-copy">お客様控</div>
        </div>
      ) : (
        <div className="mk-section-label mk-pagebreak">写 真 報 告（別紙）</div>
      )}

      <div className="mk-photo-meta">
        <span>{customer} 御中</span>
        <span>{place}</span>
        <span>{workDate}</span>
      </div>

      <div className="mk-row-actions mk-chrome">
        <button type="button" className="mk-ghost" onClick={() => fileRef.current?.click()}>
          ＋ 写真を取り込む（複数可）
        </button>
        <span className="mk-hint">取り込み済み: {photos.length}枚</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            onFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {photos.length === 0 ? (
        <p className="mk-hint">写真を取り込むと、見出し・注記つきで並びます。（赤丸注記は次イテレーションで実装）</p>
      ) : (
        <div className="mk-photo-grid">
          {photos.map((p, i) => (
            <figure key={p.id} className="mk-photo-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="mk-photo-img" src={p.url} alt={p.heading} />
              <input
                className="mk-photo-heading"
                value={p.heading}
                onChange={(e) => updatePhoto(p.id, "heading", e.target.value)}
                placeholder={`写真${i + 1} 見出し`}
              />
              <textarea
                className="mk-photo-note"
                value={p.note}
                onChange={(e) => updatePhoto(p.id, "note", e.target.value)}
                placeholder="注記メモ（例: 厨房裏に喫食痕／赤丸位置）"
              />
              <button type="button" className="mk-ghost mk-chrome" onClick={() => removePhoto(p.id)}>
                この写真を削除
              </button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>

      <div className="mk-chrome mk-toolbar">
        <div className="mk-brand">
          <strong>防除作業報告書モック</strong>
          <span className="mk-hint">同じ入力 → タブで様式を切替（統合の手前の「まな板」）</span>
        </div>
        <div className="mk-tabs">
          <button type="button" className={tab === "kanya" ? "mk-tab on" : "mk-tab"} onClick={() => setTab("kanya")}>紺谷V</button>
          <button type="button" className={tab === "photo" ? "mk-tab on" : "mk-tab"} onClick={() => setTab("photo")}>写真報告書</button>
          <button type="button" className={tab === "fusion" ? "mk-tab on" : "mk-tab"} onClick={() => setTab("fusion")}>融合</button>
          <button type="button" className="mk-print" onClick={() => window.print()}>🖨 印刷 / PDF</button>
        </div>
      </div>

      <div className="mk-chrome mk-justdb">
        <span className="mk-kv-label">JUST.DB連携</span>
        <label className="mk-inline">施工予定ID
          <input value={constructionId} onChange={(e) => setConstructionId(e.target.value)} />
        </label>
        <button type="button" className="mk-ghost" onClick={fetchCase}>JUST.DBから取得</button>
        {caseId ? <span className="mk-hint">案件ID: {caseId}</span> : null}
        {caseMsg ? <span className="mk-hint">{caseMsg}</span> : null}
      </div>

      <div className="mk-stage">
        {tab === "kanya" && renderKanya()}
        {tab === "photo" && renderPhotos(true)}
        {tab === "fusion" && (
          <>
            {renderKanya()}
            {renderPhotos(false)}
          </>
        )}
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
.mk-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.mk-tab { background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.4);
  border-radius: 999px; padding: 8px 16px; font-weight: 700; cursor: pointer; }
.mk-tab.on { background: #fff; color: #0f766e; }
.mk-print { background: #f59e0b; color: #1f2937; border: none; border-radius: 999px;
  padding: 8px 14px; font-weight: 700; cursor: pointer; }

.mk-justdb { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 10px; padding: 8px 12px; margin-bottom: 16px; }
.mk-inline { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.85rem; }
.mk-inline input { width: 150px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
.mk-justdb .mk-ghost { width: auto; }

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
.mk-pagebreak { margin-top: 22px; }

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

.mk-photo-meta { display: flex; gap: 16px; flex-wrap: wrap; color: #374151; font-weight: 600;
  font-size: 0.9rem; margin-bottom: 10px; }
.mk-photo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.mk-photo-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin: 0; display: grid; gap: 8px; }
.mk-photo-img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
.mk-photo-heading { font-weight: 700; }
.mk-photo-note { min-height: 64px; }
.mk-hint { color: #6b7280; font-size: 0.85rem; }

input, textarea, button, select { font: inherit; }
.mk-sheet input, .mk-sheet textarea { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; width: 100%; background: #fff; }

@media (max-width: 760px) {
  .mk-photo-grid { grid-template-columns: 1fr; }
  .mk-resp input { width: 100px; }
}

@media print {
  .mk-chrome { display: none !important; }
  .mk-wrap { max-width: none; padding: 0; }
  .mk-sheet { border: none; box-shadow: none; border-radius: 0; padding: 0; page-break-after: always; }
  .mk-stage { gap: 0; }
  body { background: #fff; }
}
`;
