"use client";

/**
 * 写真の並べ替えモーダル（俯瞰グリッド）。
 * - 表紙選択モーダルと同じ「全部を一覧で見る」体裁で掲載順を直す。
 * - スマホ：写真を **長押し → ドラッグ** で移動（指。長押し成立前に動けばスクロール扱い）。
 * - 保険として各セルに ↑/↓（PC・ドラッグが効かない時用）。
 * - 並びはローカルで持ち、「完了」/枠外タップで親へ反映（保存は親の「報告書保存」時）。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6
 */
import { useRef, useState } from "react";

type RItem = { fileId: string; heading: string };

type Props = {
  items: RItem[];
  photoUrl: (fileId: string) => string;
  onApply: (orderedFileIds: string[]) => void;
  onClose: () => void;
};

const LONG_PRESS_MS = 260; // この時間だけ静止し続けたらドラッグ開始
const MOVE_CANCEL_PX = 12; // 長押し成立前にこれ以上動いたらスクロール扱い

export function PhotoReorderModal({ items, photoUrl, onApply, onClose }: Props) {
  const [order, setOrder] = useState<RItem[]>(items);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const startPt = useRef<{ x: number; y: number } | null>(null);

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

  const onCellPointerDown = (e: React.PointerEvent, i: number) => {
    if (dragging) return;
    startPt.current = { x: e.clientX, y: e.clientY };
    const pointerId = e.pointerId;
    clearTimer();
    timer.current = window.setTimeout(() => {
      setDragIndex(i);
      setDragging(true);
      try {
        containerRef.current?.setPointerCapture(pointerId);
      } catch {
        /* 一部環境で未対応でも ↑↓ で代替できる */
      }
    }, LONG_PRESS_MS);
  };

  const onContainerPointerMove = (e: React.PointerEvent) => {
    if (!dragging) {
      // 長押し成立前に動いたら＝スクロール意図 → ドラッグ予約を取り消す。
      if (startPt.current) {
        const dx = Math.abs(e.clientX - startPt.current.x);
        const dy = Math.abs(e.clientY - startPt.current.y);
        if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearTimer();
      }
      return;
    }
    e.preventDefault(); // ドラッグ中はスクロールさせない
    if (dragIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest("[data-ri]") as HTMLElement | null;
    if (!cell) return;
    const to = Number(cell.dataset.ri);
    if (!Number.isNaN(to) && to !== dragIndex) {
      moveItem(dragIndex, to);
      setDragIndex(to);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    clearTimer();
    if (dragging) {
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
    setDragging(false);
    setDragIndex(null);
    startPt.current = null;
  };

  const apply = () => {
    onApply(order.map((o) => o.fileId));
    onClose();
  };

  return (
    <div className="modal-backdrop no-print" onClick={apply}>
      <div className="modal reorder-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>写真の並べ替え</h2>
        <p className="notice">
          番号がPDFの掲載順です。写真を<b>長押ししてからドラッグ</b>で移動できます（スマホは指で長押し→移動）。
          右上の <b>↑ / ↓</b> でも1つずつ動かせます。
        </p>
        <div
          ref={containerRef}
          className={`reorder-grid${dragging ? " dragging" : ""}`}
          onPointerMove={onContainerPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {order.map((it, i) => (
            <div
              key={it.fileId}
              data-ri={i}
              className={`reorder-cell${dragIndex === i && dragging ? " lifted" : ""}`}
              onPointerDown={(e) => onCellPointerDown(e, i)}
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
          ))}
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
