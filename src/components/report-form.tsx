"use client";

import { useState } from "react";

type SubmitState = {
  status: "idle" | "submitting" | "success" | "error";
  message?: string;
};

/**
 * 報告書入力フォーム。
 * 入力内容を `/api/reports` へ送信し、サーバー側でJUST.DBへ連携する。
 */
export function ReportForm() {
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const payload = {
      title: String(formData.get("title") ?? ""),
      reporter: String(formData.get("reporter") ?? ""),
      category: String(formData.get("category") ?? "daily"),
      content: String(formData.get("content") ?? "")
    };

    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "送信に失敗しました。設定を確認してください。");
      }

      event.currentTarget.reset();
      setState({
        status: "success",
        message: "報告書を登録しました。"
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "送信中に不明なエラーが発生しました。"
      });
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div>
        <label htmlFor="title">件名</label>
        <input id="title" name="title" required maxLength={120} />
      </div>

      <div>
        <label htmlFor="reporter">報告者</label>
        <input id="reporter" name="reporter" required maxLength={80} />
      </div>

      <div>
        <label htmlFor="category">区分</label>
        <select id="category" name="category" defaultValue="daily">
          <option value="daily">日報</option>
          <option value="incident">障害報告</option>
          <option value="proposal">改善提案</option>
        </select>
      </div>

      <div>
        <label htmlFor="content">内容</label>
        <textarea id="content" name="content" required maxLength={4000} />
      </div>

      <button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "送信中..." : "報告書を登録"}
      </button>

      {state.message ? (
        <p className={`notice ${state.status === "error" ? "error" : "success"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
