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
  // 一覧では道具を隠して写真だけ表示し、タップで集中モードに入る（グリッドの脱・ボタン化）。
  compact?: boolean;
  // 見出しを集中モード（拡大窓）の中で編集する（一覧側は小さく表示）。
  heading?: string;
  onHeadingChange?: (v: string) => void;
  headingPlaceholder?: string;
};

export function PhotoAnnotator({
  src,
  alt,
  value,
  onChange,
  compact,
  heading,
  onHeadingChange,
  headingPlaceholder
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const drawing = useRef(false);
  // 選択中の図形をドラッグで移動／端点ドラッグで拡縮する。move 中は onChange のみ更新し、
  // 確定時に「開始前の配列」を1回だけ undo へ積む（ドラッグ＝1操作）。
  const dragRef = useRef<{
    mode: "move" | "resize";
    id: string;
    ptIndex: number;
    start: AnnotationPoint;
    base: Annotation;
    before: Annotation[];
    moved: boolean;
  } | null>(null);
  // 文字ツール：タップ位置を覚えてアプリ内モーダルで入力する（ネイティブ window.prompt は
  // モバイルで pointerdown 中に開くと閉じても再発火する＝無限に開き直す不具合があるため使わない）。
  const [textDraft, setTextDraft] = useState<AnnotationPoint | null>(null);
  const [textValue, setTextValue] = useState("");
  // 集中モード：描画ツール（選択以外）を選ぶと、その写真を画面中央に固定し背景を暗転する。
  // 小さなグリッド上で狙って描く／動かすのは辛いので、主役の写真だけを大きく出す。
  // ツールとは独立した状態にして、集中したまま「選択」へ切り替えて移動・拡縮・色替えもできる。
  const [focused, setFocused] = useState(false);
  const exitFocus = useCallback(() => {
    setFocused(false);
    setTool("select");
    setSelectedId(null);
  }, []);
  useBodyScrollLock(focused || textDraft !== null); // 集中モード／文字入力中は背景を凍結

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
      // 図形は各図形の onPointerDown(beginMove/beginResize) が stopPropagation するので、
      // ここに来る＝余白を押した。選択ツールなら「余白押下＝選択解除」（click の e.target 判定は
      // setPointerCapture 後に SVG を指してしまい選択直後に解除されるため、pointerdown で行う）。
      if (tool === "select") {
        setSelectedId(null);
        return;
      }
      if (tool === "text") return;
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
      const id = newId();
      commit([...value, { id, type: "text", points: [textDraft], color, text: t.slice(0, 500) }]);
      // 追加直後に「選択」ツールへ切替＋その文字を選択状態にする＝指を離したあとも、
      // そのまま写真内をドラッグして置き場所を微調整できる（作った瞬間に位置決めできる）。
      setTool("select");
      setSelectedId(id);
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
      // 描画中
      if (drawing.current && draft) {
        const p = norm(e.clientX, e.clientY);
        setDraft((d) => {
          if (!d) return d;
          if (d.type === "freehand") {
            const pts = d.points ?? [];
            return { ...d, points: [...pts, p] };
          }
          return { ...d, points: [d.points?.[0] ?? p, p] };
        });
        return;
      }
      // 移動／拡縮中（選択図形のドラッグ）
      const d = dragRef.current;
      if (!d) return;
      const p = norm(e.clientX, e.clientY);
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) d.moved = true;
      const basePts = d.base.points ?? [];
      const nextPts =
        d.mode === "move"
          ? basePts.map((pt) => ({ x: clamp01(pt.x + dx), y: clamp01(pt.y + dy) }))
          : basePts.map((pt, i) =>
              i === d.ptIndex ? { x: clamp01(pt.x + dx), y: clamp01(pt.y + dy) } : pt
            );
      onChange(value.map((a) => (a.id === d.id ? { ...d.base, points: nextPts } : a)));
    },
    [draft, norm, value, onChange]
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

  // 選択図形の移動／端点拡縮の開始・終了。開始時に選択＋色をパレットへ反映（#1）。
  const beginMove = useCallback(
    (e: React.PointerEvent, a: Annotation) => {
      if (tool !== "select") return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedId(a.id);
      setColor(a.color ?? COLORS[0]);
      svgRef.current?.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "move",
        id: a.id,
        ptIndex: -1,
        start: norm(e.clientX, e.clientY),
        base: a,
        before: value,
        moved: false
      };
    },
    [tool, norm, value]
  );

  const beginResize = useCallback(
    (e: React.PointerEvent, a: Annotation, ptIndex: number) => {
      if (tool !== "select") return;
      e.stopPropagation();
      e.preventDefault();
      setSelectedId(a.id);
      setColor(a.color ?? COLORS[0]);
      svgRef.current?.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode: "resize",
        id: a.id,
        ptIndex,
        start: norm(e.clientX, e.clientY),
        base: a,
        before: value,
        moved: false
      };
    },
    [tool, norm, value]
  );

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.moved) {
      setPast((p) => [...p, d.before]); // ドラッグ全体で1回だけ undo に積む
      setFuture([]);
    }
  }, []);

  const px = useCallback((p: AnnotationPoint) => ({ x: p.x * box.w, y: p.y * box.h }), [box]);

  function renderShape(a: Annotation, isDraft: boolean) {
    const pts = (a.points ?? []).map(px);
    if (pts.length === 0) return null;
    const stroke = a.color ?? "#e11d48";
    const selected = !isDraft && a.id === selectedId;
    // 選択モード（一覧の縮小表示 idle を除く）では、図形の内部（fill:none でも）まで掴めるよう
    // pointer-events:all にする。これが無いと PC のマウスでは 2.5px の線の上を正確に射抜かない限り
    // 選択できず「クリックで保持できない」＝今回の不具合の主因（指より細いポインタで顕著）。
    const selectable = !isDraft && tool === "select" && (!compact || focused);
    const common = {
      stroke,
      strokeWidth: selected ? 4 : 2.5,
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      onPointerDown: selectable ? (ev: React.PointerEvent) => beginMove(ev, a) : undefined,
      style: {
        pointerEvents: (selectable ? "all" : "none") as "all" | "none",
        cursor: selectable ? ("move" as const) : undefined
      }
    };
    // 細い線・矢印・手書きは stroke が細く PC で掴みづらいので、透明な太い当たり判定線を重ねる。
    const hitStroke = (
      node: "line" | "polyline",
      geom: { x1?: number; y1?: number; x2?: number; y2?: number; points?: string }
    ) => {
      if (!selectable) return null;
      const p = {
        stroke: "transparent",
        strokeWidth: 16,
        fill: "none" as const,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        style: { pointerEvents: "stroke" as const, cursor: "move" as const },
        onPointerDown: (ev: React.PointerEvent) => beginMove(ev, a)
      };
      return node === "line" ? <line {...p} {...geom} /> : <polyline {...p} points={geom.points} />;
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
      return (
        <>
          {hitStroke("line", { x1: s.x, y1: s.y, x2: e.x, y2: e.y })}
          <line {...common} x1={s.x} y1={s.y} x2={e.x} y2={e.y} />
        </>
      );
    }
    if (a.type === "arrow") {
      const [s, e] = pts;
      const ang = Math.atan2(e.y - s.y, e.x - s.x);
      const L = 14;
      const a1 = ang + (Math.PI * 5) / 6;
      const a2 = ang - (Math.PI * 5) / 6;
      return (
        <>
          {hitStroke("line", { x1: s.x, y1: s.y, x2: e.x, y2: e.y })}
          <g {...common}>
            <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} />
            <line x1={e.x} y1={e.y} x2={e.x + L * Math.cos(a1)} y2={e.y + L * Math.sin(a1)} />
            <line x1={e.x} y1={e.y} x2={e.x + L * Math.cos(a2)} y2={e.y + L * Math.sin(a2)} />
          </g>
        </>
      );
    }
    if (a.type === "freehand") {
      const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
      return (
        <>
          {hitStroke("polyline", { points: ptsStr })}
          <polyline {...common} points={ptsStr} />
        </>
      );
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
          onPointerDown={common.onPointerDown}
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

  // 選択中の図形が一目で分かるように、輪郭を囲む破線フレーム＋薄い塗りを重ねる
  // （strokeWidth を太らせるだけでは見分けがつかない、というフィードバックへの対応）。
  function renderSelectionFrame(a: Annotation) {
    const pts = (a.points ?? []).map(px);
    if (pts.length === 0) return null;
    let minX = Math.min(...pts.map((p) => p.x));
    let minY = Math.min(...pts.map((p) => p.y));
    let maxX = Math.max(...pts.map((p) => p.x));
    let maxY = Math.max(...pts.map((p) => p.y));
    if (a.type === "text") {
      // テキストは1点（左下=baseline）保持なので、文字数から概算の外接矩形を作る。
      const fs = 22;
      const w = Math.max(28, (a.text?.length ?? 1) * fs * 0.62);
      minX = pts[0].x - 4;
      minY = pts[0].y - fs - 2;
      maxX = pts[0].x + w;
      maxY = pts[0].y + 6;
    }
    const pad = 6;
    return (
      <rect
        x={minX - pad}
        y={minY - pad}
        width={maxX - minX + pad * 2}
        height={maxY - minY + pad * 2}
        rx={5}
        fill="rgba(37,99,235,0.10)"
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
        style={tool === "select" ? { cursor: "move" } : undefined}
        onPointerDown={(ev) => beginMove(ev, a)}
      />
    );
  }

  // 拡縮ハンドル：2点図形（丸/囲/矢印/線）の端点に掴みやすい円を出す。
  // 手書き・文字は点数や1点保持のため v1 は移動のみ（ハンドルなし）。
  function renderHandles(a: Annotation) {
    if (tool !== "select") return null;
    if (a.type !== "circle" && a.type !== "rect" && a.type !== "line" && a.type !== "arrow") {
      return null;
    }
    const pts = (a.points ?? []).map(px);
    if (pts.length < 2) return null;
    return (
      <>
        {[0, 1].map((i) => (
          <circle
            key={i}
            cx={pts[i].x}
            cy={pts[i].y}
            r={9}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "nwse-resize" }}
            onPointerDown={(ev) => beginResize(ev, a, i)}
          />
        ))}
      </>
    );
  }

  const ready = box.w > 0 && box.h > 0;
  // idle＝一覧の縮小表示（道具を隠し、注記は見せるだけ・タップで集中モードへ）。
  const idle = !!compact && !focused;

  return (
    <div className={`annot${focused ? " annot--focus" : ""}`}>
      {focused ? <div className="annot-focus-backdrop no-print" onClick={exitFocus} /> : null}
      {idle ? null : (
      <div className="annot-toolbar no-print">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`annot-tool${tool === t.id ? " active" : ""}`}
            onClick={() => {
              setTool(t.id);
              // 描画ツールを持つと集中モードへ。「選択」への切替では集中を維持＝そのまま編集。
              if (t.id !== "select") {
                setSelectedId(null);
                setFocused(true);
              }
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
        {focused ? (
          <button type="button" className="annot-tool annot-done" onClick={exitFocus}>
            ✓ 完了
          </button>
        ) : null}
      </div>
      )}

      {focused && onHeadingChange ? (
        <input
          className="annot-heading-input no-print"
          type="text"
          value={heading ?? ""}
          maxLength={80}
          placeholder={headingPlaceholder ?? "見出し"}
          onChange={(e) => onHeadingChange(e.target.value)}
          aria-label="見出し"
        />
      ) : null}

      <div
        className="annot-wrap"
        ref={wrapRef}
        onClick={idle ? () => setFocused(true) : undefined}
        style={idle ? { cursor: "pointer" } : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="annot-img" src={src} alt={alt} draggable={false} />
        {ready ? (
          <svg
            ref={svgRef}
            className="annot-svg"
            viewBox={`0 0 ${box.w} ${box.h}`}
            preserveAspectRatio="none"
            style={{
              touchAction: "none",
              pointerEvents: idle ? "none" : "auto", // 一覧では注記は「見せるだけ」＝タップは背面の写真へ
              cursor: idle ? "pointer" : tool === "select" ? "default" : "crosshair"
            }}
            onPointerDown={idle ? undefined : onPointerDown}
            onPointerMove={idle ? undefined : onPointerMove}
            onPointerUp={
              idle
                ? undefined
                : () => {
                    finishDraft();
                    endDrag();
                  }
            }
            onPointerCancel={
              idle
                ? undefined
                : () => {
                    finishDraft();
                    endDrag();
                  }
            }
            onClick={
              idle
                ? undefined
                : (e) => {
                    if (tool === "text") {
                      // タップ位置を覚えて入力モーダルを開く（クリック完了後に開くのでループしない）。
                      setTextValue("");
                      setTextDraft(norm(e.clientX, e.clientY));
                      return;
                    }
                    // 選択解除は onPointerDown（背景押下）で処理する。ここで e.target を見て解除すると
                    // setPointerCapture 後の click が SVG を指し、選択直後に解除されてしまう。
                  }
            }
          >
            {value.map((a) => (
              <g key={a.id}>
                {!idle && a.id === selectedId ? renderSelectionFrame(a) : null}
                {renderShape(a, false)}
                {!idle && a.id === selectedId ? renderHandles(a) : null}
              </g>
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
