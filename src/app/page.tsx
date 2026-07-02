import Link from "next/link";

/**
 * トップページ。
 * 本番運用ではJUST.DBのアプリリンク経由で `/report/new` を利用する。
 */
export default function HomePage() {
  return (
    <main>
      <section className="panel">
        <h1>報告書作成アプリ</h1>
        <p>Slack の案件トピック（総合窓口）または JUST.DB のアプリリンクからアクセスしてください。</p>
        <p className="notice">
          開発時は案件ポータル
          <Link href="/portal?caseId=DEMO001">/portal?caseId=DEMO001</Link>
          から確認できます。
        </p>
      </section>
    </main>
  );
}
