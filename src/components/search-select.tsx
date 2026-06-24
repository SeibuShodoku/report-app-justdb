"use client";

/**
 * 検索つきセレクト（コンボボックス）。
 * ネイティブ <select> の代わりに、入力で絞り込めるドロップダウンを出す（薬剤426件等で有用・モバイルでも扱いやすい）。
 * 依存なし。選択値は value（キー）、表示は label。
 */
import { useState } from "react";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
};

export function SearchSelect({ value, options, onChange, placeholder = "選択／入力で検索", allowClear = true }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q === "" ? options : options.filter((o) => o.label.toLowerCase().includes(q));

  return (
    <div className="ss">
      <input
        className="ss-input"
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {allowClear && value ? (
        <button
          type="button"
          className="ss-clear"
          aria-label="クリア"
          onMouseDown={(e) => {
            e.preventDefault();
            onChange("");
            setQuery("");
          }}
        >
          ×
        </button>
      ) : null}
      {open ? (
        <ul className="ss-list">
          {filtered.length === 0 ? (
            <li className="ss-empty">該当なし</li>
          ) : (
            filtered.slice(0, 80).map((o) => (
              <li
                key={o.value}
                className={o.value === value ? "ss-opt sel" : "ss-opt"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.value);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {o.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
