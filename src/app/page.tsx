import { ReportForm } from "@/components/report-form";

export default function HomePage() {
  return (
    <main>
      <section className="panel">
        <h1>報告書作成アプリ</h1>
        <p>入力内容をサーバー経由でJUST.DBに登録します。</p>
        <ReportForm />
      </section>
    </main>
  );
}
