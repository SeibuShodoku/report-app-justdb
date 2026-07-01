"use client";

/**
 * 写真の並べ替えモーダル（俯瞰グリッド）。
 * - 表紙選択モーダルと同じ「全部を一覧で見る」体裁で掲載順を直す。
 * - スクロール領域は `touch-action: none` で **ジェスチャの主導権をこちらが完全に握る**
 *   （ブラウザに途中で「スクロールだ」と奪われない＝長押し後のドラッグが確実／プル更新も起きない）。
 *   その代わり、指でのスクロールは自前で scrollTop を動かす（長押し前に動かす＝スクロール意図）。
 * - 写真を **長押し(260ms静止) → ドラッグ** で移動。端に寄せると自動スクロール。
 * - 保険として各セルに ↑/↓（PC・細かい調整用）。背景は表示中スクロール凍結（useBodyScrollLock）。
 * - 並びはローカルで持ち、「完了」/枠外タップで親へ反映（保存は親の「報告書保存」時）。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6
 */
import { Fragment, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

type RItem = { fileId: string; heading: string };

type Props = {
  items: RItem[];
  photoUrl: (fileId: string) => string;
  onApply: (orderedFileIds: string[]) => void;
  onClose: () => void;
};

const PER_PAGE = 8; // A4の1ページ＝横2×縦4＝8枚。並び順もこのページ割りで見せる（端末非依存）
const LONG_PRESS_MS = 260; // この時間だけ静止し続けたらドラッグ開始
const MOVE_CANCEL_PX = 12; // 長押し成立前にこれ以上動いたらスクロール意図
const EDGE_PX = 44; // ドラッグ中、上下この範囲に来たら自動スクロール
const EDGE_STEP = 16; // 自動スクロール量(px/move)

type Mode = "idle" | "scroll" | "drag";

export function PhotoReorderModal({ items, photoUrl, onApply, onClose }: Props) {
  const [order, setOrder] = useState<RItem[]>(items);
  const [dragIndex, setDragIndex] = useState<number | null>(null); // 持ち上げ表示用
  const [dragging, setDragging] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const mode = useRef<Mode>("idle");
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const lastY = useRef(0);
  const curDrag = useRef<number | null>(null); // ドラッグ中の現在位置（state遅延に依存しない）

  useBodyScrollLock(true); // マウント中＝モーダル表示中。背景を凍結。

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const moveItem = (from: number, to: number) => {
    setOrder((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const cell = (e.target as HTMLElement).closest?.("[data-ri]") as HTMLElement | null;
    mode.current = "idle";
    startPt.current = { x: e.clientX, y: e.clientY };
    lastY.current = e.clientY;
    try {
      scrollRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* 一部環境で未対応でも ↑↓ で代替できる */
    }
    clearTimer();
    if (cell) {
      const idx = Number(cell.dataset.ri);
      timer.current = window.setTimeout(() => {
        mode.current = "drag";
        curDrag.current = idx;
        setDragIndex(idx);
        setDragging(true);
        try {
          if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
        } catch {
          /* 触覚フィードバック未対応は無視 */
        }
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (mode.current === "idle") {
      if (startPt.current) {
        const dx = Math.abs(e.clientX - startPt.current.x);
        const dy = Math.abs(e.clientY - startPt.current.y);
        if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
          clearTimer();
          mode.current = "scroll"; // 長押し前に動いた＝スクロール意図
        }
      }
    }

    if (mode.current === "scroll") {
      e.preventDefault();
      const sc = scrollRef.current;
      if (sc) sc.scrollTop -= e.clientY - lastY.current; // 自前スクロール
      lastY.current = e.clientY;
      return;
    }

    if (mode.current === "drag") {
      e.preventDefault();
      const sc = scrollRef.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (e.clientY < r.top + EDGE_PX) sc.scrollTop -= EDGE_STEP;
        else if (e.clientY > r.bottom - EDGE_PX) sc.scrollTop += EDGE_STEP;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const cell = el?.closest("[data-ri]") as HTMLElement | null;
      const from = curDrag.current;
      if (cell && from !== null) {
        const to = Number(cell.dataset.ri);
        if (!Number.isNaN(to) && to !== from) {
          moveItem(from, to);
          curDrag.current = to;
          setDragIndex(to);
        }
      }
      lastY.current = e.clientY;
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    clearTimer();
    try {
      scrollRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    mode.current = "idle";
    curDrag.current = null;
    startPt.current = null;
    setDragIndex(null);
    setDragging(false);
  };

  const apply = () => {
    onApply(order.map((o) => o.fileId));
    onClose();
  };

  return (
    <div className="modal-backdrop no-print" onClick={apply}>
      <div className="modal reorder-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="inline-actions" style={{ justifyContent: "space-between" }}>
          <h2>写真の並べ替え</h2>
          <button type="button" className="btn-secondary" onClick={apply}>
            閉じる
          </button>
        </div>
        <p className="notice">
          A4の1ページ＝<b>横2×縦4＝8枚</b>の割り付けで表示します（PDFと同じ並び・端末で崩れません）。
          写真を<b>長押ししてからドラッグ</b>で移動（スマホは指で長押し→移動）。一覧は指でスクロール、右上の <b>↑ / ↓</b> でも1つずつ動かせます。
        </p>
        <div
          ref={scrollRef}
          className={`reorder-scroll${dragging ? " dragging" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <div className="reorder-grid">
            {order.map((it, i) => (
              <Fragment key={it.fileId}>
                {i % PER_PAGE === 0 ? (
                  <div className="reorder-pagebreak">
                    {Math.floor(i / PER_PAGE) + 1}ページ目（{i + 1}–{Math.min(i + PER_PAGE, order.length)}枚）
                  </div>
                ) : null}
              <div
                data-ri={i}
                className={`reorder-cell${dragIndex === i && dragging ? " lifted" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(it.fileId)} alt={`写真 ${i + 1}`} draggable={false} />
                <span className="reorder-no">
                  {i + 1}
                  {it.heading ? `・${it.heading}` : ""}
                </span>
                <span className="reorder-updown">
                  <button
                    type="button"
                    aria-label="前へ"
                    disabled={i === 0}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => moveItem(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="後へ"
                    disabled={i === order.length - 1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => moveItem(i, i + 1)}
                  >
                    ↓
                  </button>
                </span>
              </div>
              </Fragment>
            ))}
          </div>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={apply}>
            完了
          </button>
        </div>
      </div>
    </div>
  );
}
