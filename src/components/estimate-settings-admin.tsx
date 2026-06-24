"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EstimateSettings } from "@/lib/estimate-calc";
import type { EstimateSettingsVersion } from "@/lib/estimate-settings-store";

/**
 * 見積 計算式設定の管理 UI（社内・IAP）。版一覧＋新しい改定版の作成フォーム。
 * 認可は IAP（ページが社内SSO配下）。作成は `/api/admin/estimate-settings` に POST。
 */

type Props = {
  versions: EstimateSettingsVersion[];
  today: string; // YYYY-MM-DD
  activeId: number | null; // 本日時点で有効な版の id
  fallback: EstimateSettings; // 版が無いときの既定
};

function fmtRate(n: number): string {
  // 0.16 → "16%"
  return `${Math.round(n * 1000) / 10}%`;
}

export function EstimateSettingsAdmin({ versions, today, activeId, fallback }: Props) {
  const router = useRouter();
  // 直近の版（無ければ既定）をフォームの初期値に。
  const seed = versions[0] ?? fallback;

  const [label, setLabel] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [laborUnitPrice, setLaborUnitPrice] = useState(String(seed.laborUnitPrice));
  const [travelUnitPrice, setTravelUnitPrice] = useState(String(seed.travelUnitPrice));
  const [safetyRate, setSafetyRate] = useState(String(seed.safetyRate));
  const [overheadRate, setOverheadRate] = useState(String(seed.overheadRate));
  const [chemicalMarkup, setChemicalMarkup] = useState(String(seed.chemicalMarkup));
  const [taxRate, setTaxRate] = useState(String(seed.taxRate));
  const [costCoefficients, setCostCoefficients] = useState(
    (seed.costCoefficientOptions ?? []).join(",")
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const payload = {
      label: label.trim(),
      effectiveFrom,
      laborUnitPrice: Number(laborUnitPrice),
      travelUnitPrice: Number(travelUnitPrice),
      safetyRate: Number(safetyRate),
      overheadRate: Number(overheadRate),
      chemicalMarkup: Number(chemicalMarkup),
      taxRate: Number(taxRate),
      costCoefficientOptions: costCoefficients
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0),
      note: note.trim() || undefined,
      isActive: true
    };
    try {
      const res = await fetch("/api/admin/estimate-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setLabel("");
        setNote("");
        setMessage("版を作成しました。");
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setMessage(`作成に失敗：${body.error ?? res.status}`);
      }
    } catch (err) {
      setMessage(`通信エラー：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-block">
      <h2>版の一覧</h2>
      {versions.length === 0 ? (
        <p className="notice">
          まだ版がありません（既定値で計算されます）。下のフォームで初版を作成してください。
        </p>
      ) : (
        <table className="version-list">
          <thead>
            <tr>
              <th>識別キー</th>
              <th>適用開始</th>
              <th>人件費/時</th>
              <th>移動/km</th>
              <th>労安率</th>
              <th>諸経費率</th>
              <th>薬剤係数</th>
              <th>消費税</th>
              <th>原価係数</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{v.label}</td>
                <td>{v.effectiveFrom}</td>
                <td>¥{v.laborUnitPrice.toLocaleString()}</td>
                <td>¥{v.travelUnitPrice.toLocaleString()}</td>
                <td>{fmtRate(v.safetyRate)}</td>
                <td>{fmtRate(v.overheadRate)}</td>
                <td>{v.chemicalMarkup}</td>
                <td>{fmtRate(v.taxRate)}</td>
                <td>{(v.costCoefficientOptions ?? []).join(" / ")}</td>
                <td>
                  {!v.isActive ? "無効" : v.id === activeId ? "★ 本日有効" : "有効"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>新しい改定版を作成</h2>
      <form onSubmit={submit}>
        <div className="editor-field">
          <label>
            識別キー（例 2026年度10月）
            <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={60} />
          </label>
        </div>
        <div className="editor-field">
          <label>
            適用開始日
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            施工人件費単価（円/時）
            <input type="number" min={0} step={1} value={laborUnitPrice} onChange={(e) => setLaborUnitPrice(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            移動費用単価（円/km）
            <input type="number" min={0} step={1} value={travelUnitPrice} onChange={(e) => setTravelUnitPrice(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            労安費率（例 0.16）
            <input type="number" min={0} max={1} step={0.01} value={safetyRate} onChange={(e) => setSafetyRate(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            諸経費率（例 0.20）
            <input type="number" min={0} max={1} step={0.01} value={overheadRate} onChange={(e) => setOverheadRate(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            薬剤係数 売価÷係数＝原価（例 1.6）
            <input type="number" min={0} step={0.01} value={chemicalMarkup} onChange={(e) => setChemicalMarkup(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            消費税率（例 0.10）
            <input type="number" min={0} max={1} step={0.01} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} required />
          </label>
        </div>
        <div className="editor-field">
          <label>
            原価係数の選択肢（カンマ区切り 例 0.3,0.55）
            <input value={costCoefficients} onChange={(e) => setCostCoefficients(e.target.value)} />
          </label>
        </div>
        <div className="editor-field">
          <label>
            メモ（任意）
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
        </div>
        <div className="inline-actions">
          <button type="submit" disabled={busy}>
            {busy ? "作成中…" : "この内容で版を作成"}
          </button>
          {message ? <span className="notice">{message}</span> : null}
        </div>
      </form>
    </div>
  );
}
