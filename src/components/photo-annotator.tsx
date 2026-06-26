"use client";

/**
 * 写真の上に重ねる注記レイヤー（赤丸・矢印・線・フリーハンド・テキスト）。
 * - 写真ピクセルは編集しない。注記は **透明 SVG のベクター**（印刷でも崩れない・選択/削除容易）。
 * - 入力は **Pointer Events**（マウス/指/ペンを統一）。
 * - 座標は **0〜1 の正規化値**で保持（表示サイズ非依存で写真にピタリ重なる）。
 *   描画時は実表示ボックス(px)を ResizeObserver で測り、正規化↔pxを相互変換する（均一px空間＝歪まない）。
 * - UNDO/REDO は配列スナップショットの push/pop。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6 / report-formats.md §3
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationPoint } from "@/schemas/photo-report";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type Tool = "select" | "circle" | "rect" | "line" | "arrow" | "freehand" | "text";

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "select", label: "選択" },
  { id: "circle", label: "○丸" },
  { id: "rect", label: "□囲" },
  { id: "arrow", label: "→矢印" },
  { id: "line", label: "／線" },
  { id: "freehand", label: "✎手書き" },
  { id: "text", label: "Ａ文字" }
];

const COLORS = ["#e11d48", "#2563eb", "#f59e0b", "#111827", "#ffffff"];

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().slice(0, 32);
  } catch {
    /* noop */
  }
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

type Props = {
  src: string;
  alt: string;
  value: Annotation[];
  onChange: (next: Annotation[]) => void;
};

export function PhotoAnnotator({ src, alt, value, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const drawing = useRef(false);
  // 文字ツール：タップ位置を覚えてアプリ内モーダルで入力する（ネイティブ window.prompt は
  // モバイルで pointerdown 中に開くと閉じても再発火する＝無限に開き直す不具合があるため使わない）。
  const [textDraft, setTextDraft] = useState<AnnotationPoint | null>(null);
  const [textValue, setTextValue] = useState("");
  useBodyScrollLock(textDraft !== null); // 文字入力モーダル中は背景を凍結

  // UNDO/REDO 用スナップショット（onChange を起こす確定操作の前後で積む）。
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const commit = useCallback(
    (next: Annotation[]) => {
      setPast((p) => [...p, value]);
      setFuture([]);
      onChange(next);
    },
    [onChange, value]
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, value]);
    onChange(prev);
  }, [onChange, value, past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const nxt = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, value]);
    onChange(nxt);
  }, [onChange, value, future]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(value.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, value, commit]);

  // クライアント座標 → 正規化(0..1)
  const norm = useCallback((clientX: number, clientY: number): AnnotationPoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height)
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // 選択は図形側 onClick、文字は svg onClick（モーダル）で処理＝ここでは描画系のみ。
      if (tool === "select" || tool === "text") return;
      e.preventDefault();
      const p = norm(e.clientX, e.clientY);
      svgRef.current?.setPointerCapture(e.pointerId);
      drawing.current = true;
      const type: Annotation["type"] = tool;
      setDraft({ id: newId(), type, points: tool === "freehand" ? [p] : [p, p], color });
    },
    [tool, norm, color]
  );

  // 文字注記を確定（モーダルの「追加」/Enter）。空なら破棄。
  const commitText = useCallback(() => {
    const t = textValue.trim();
    if (textDraft && t) {
      commit([...value, { id: newId(), type: "text", points: [textDraft], color, text: t.slice(0, 500) }]);
    }
    setTextDraft(null);
    setTextValue("");
  }, [textDraft, textValue, value, color, commit]);

  const cancelText = useCallback(() => {
    setTextDraft(null);
    setTextValue("");
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawing.current || !draft) return;
      const p = norm(e.clientX, e.clientY);
      setDraft((d) => {
        if (!d) return d;
        if (d.type === "freehand") {
          const pts = d.points ?? [];
          return { ...d, points: [...pts, p] };
        }
        return { ...d, points: [d.points?.[0] ?? p, p] };
      });
    },
    [draft, norm]
  );

  const finishDraft = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!draft) return;
    const pts = draft.points ?? [];
    // 退化（ほぼ点）の図形は捨てる。freehand は2点以上で採用。
    const degenerate =
      draft.type === "freehand"
        ? pts.length < 2
        : pts.length < 2 ||
          (Math.abs(pts[0].x - pts[1].x) < 0.01 && Math.abs(pts[0].y - pts[1].y) < 0.01);
    if (!degenerate) commit([...value, draft]);
    setDraft(null);
  }, [draft, value, commit]);

  const px = useCallback((p: AnnotationPoint) => ({ x: p.x * box.w, y: p.y * box.h }), [box]);

  function renderShape(a: Annotation, isDraft: boolean) {
    const pts = (a.points ?? []).map(px);
    if (pts.length === 0) return null;
    const stroke = a.color ?? "#e11d48";
    const selected = !isDraft && a.id === selectedId;
    const common = {
      stroke,
      strokeWidth: selected ? 4 : 2.5,
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      onClick: isDraft
        ? undefined
        : (ev: React.MouseEvent) => {
            if (tool !== "select") return;
            ev.stopPropagation();
            setSelectedId(a.id);
          },
      style: tool === "select" && !isDraft ? { cursor: "pointer" } : undefined
    };

    if (a.type === "circle") {
      const [s, e] = pts;
      return (
        <ellipse
          {...common}
          cx={(s.x + e.x) / 2}
          cy={(s.y + e.y) / 2}
          rx={Math.abs(e.x - s.x) / 2}
          ry={Math.abs(e.y - s.y) / 2}
        />
      );
    }
    if (a.type === "rect") {
      const [s, e] = pts;
      return (
        <rect
          {...common}
          x={Math.min(s.x, e.x)}
          y={Math.min(s.y, e.y)}
          width={Math.abs(e.x - s.x)}
          height={Math.abs(e.y - s.y)}
        />
      );
    }
    if (a.type === "line") {
      const [s, e] = pts;
      return <line {...common} x1={s.x} y1={s.y} x2={e.x} y2={e.y} />;
    }
    if (a.type === "arrow") {
      const [s, e] = pts;
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const L = 14;
      const a1 = ang + (Math.PI * 5) / 6;
      const a2 = ang - (Math.PI * 5) / 6;
      return (
        <g {...common}>
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} />
          <line x1={e.x} y1={e.y} x2={e.x + L * Math.cos(a1)} y2={e.y + L * Math.sin(a1)} />
          <line x1={e.x} y1={e.y} x2={e.x + L * Math.cos(a2)} y2={e.y + L * Math.sin(a2)} />
        </g>
      );
    }
    if (a.type === "freehand") {
      return <polyline {...common} points={pts.map((p) => `${p.x},${p.y}`).join(" ")} />;
    }
    if (a.type === "text") {
      const [s] = pts;
      return (
        <text
          x={s.x}
          y={s.y}
          fill={stroke}
          fontSize={selected ? 22 : 18}
          fontWeight={700}
          style={common.style}
          onClick={common.onClick}
          paintOrder="stroke"
          stroke="#fff"
          strokeWidth={selected ? 4 : 3}
          strokeLinejoin="round"
        >
          {a.text}
        </text>
      );
    }
    return null;
  }

  const ready = box.w > 0 && box.h > 0;

  return (
    <div className="annot">
      <div className="annot-toolbar no-print">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`annot-tool${tool === t.id ? " active" : ""}`}
            onClick={() => {
              setTool(t.id);
              if (t.id !== "select") setSelectedId(null);
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="annot-colors">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`annot-swatch${color === c ? " active" : ""}`}
              style={{ background: c }}
              aria-label={`色 ${c}`}
              onClick={() => {
                setColor(c);
                if (selectedId) {
                  commit(value.map((a) => (a.id === selectedId ? { ...a, color: c } : a)));
                }
              }}
            />
          ))}
        </span>
        <button type="button" className="annot-tool" onClick={undo} disabled={past.length === 0}>
          ↶戻す
        </button>
        <button type="button" className="annot-tool" onClick={redo} disabled={future.length === 0}>
          ↷やり直す
        </button>
        <button type="button" className="annot-tool" onClick={deleteSelected} disabled={!selectedId}>
          削除
        </button>
      </div>

      <div className="annot-wrap" ref={wrapRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="annot-img" src={src} alt={alt} draggable={false} />
        {ready ? (
          <svg
            ref={svgRef}
            className="annot-svg"
            viewBox={`0 0 ${box.w} ${box.h}`}
            preserveAspectRatio="none"
            style={{ touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDraft}
            onPointerCancel={finishDraft}
            onClick={(e) => {
              if (tool === "text") {
                // タップ位置を覚えて入力モーダルを開く（クリック完了後に開くのでループしない）。
                setTextValue("");
                setTextDraft(norm(e.clientX, e.clientY));
                return;
              }
              // 余白クリックで選択解除（図形側は stopPropagation 済み）。
              if (tool === "select" && e.target === svgRef.current) setSelectedId(null);
            }}
          >
            {value.map((a) => (
              <g key={a.id}>{renderShape(a, false)}</g>
            ))}
            {draft ? <g>{renderShape(draft, true)}</g> : null}
          </svg>
        ) : null}
      </div>

      {textDraft ? (
        <div className="modal-backdrop no-print" onClick={cancelText}>
          <div className="modal annot-text-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>注記テキスト</h2>
            <input
              type="text"
              autoFocus
              value={textValue}
              maxLength={500}
              placeholder="写真に入れる文字"
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitText();
                if (e.key === "Escape") cancelText();
              }}
            />
            <div className="inline-actions">
              <button type="button" onClick={commitText} disabled={!textValue.trim()}>
                追加
              </button>
              <button type="button" className="btn-secondary" onClick={cancelText}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
