"use client";

/**
 * PDF 保存ボタン。本番のサーバー側 PDF 生成までの当面手段として window.print() を使う
 * （印刷 CSS で操作系を除去・A4 固定）。report-formats.md §8 準拠。
 */
export function PrintButton() {
  return (
    <button type="button" className="no-print" onClick={() => window.print()}>
      PDFで保存（印刷）
    </button>
  );
}
