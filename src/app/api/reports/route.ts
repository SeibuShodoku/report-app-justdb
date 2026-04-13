import { NextResponse } from "next/server";
import { saveReport } from "@/lib/report-store";
import { verifyLaunchToken } from "@/lib/security/launch-token";
import { reportSubmissionSchema } from "@/schemas/report";

/**
 * 報告書登録API。
 * フロントから受け取った入力を検証し、アプリ側ストレージへ保存する。
 */
export async function POST(request: Request) {
  try {
    const json = await request.json();
    const submission = reportSubmissionSchema.parse(json);
    if (submission.token) {
      const tokenPayload = verifyLaunchToken(submission.token);
      if (
        tokenPayload.caseId !== submission.caseId ||
        tokenPayload.investigationId !== submission.investigationId ||
        tokenPayload.constructionId !== submission.constructionId ||
        tokenPayload.driveFolderId !== submission.driveFolderId
      ) {
        return NextResponse.json(
          { error: "トークン内容と送信パラメータが一致しません。" },
          { status: 403 }
        );
      }
    }

    const reportId = await saveReport(submission);
    return NextResponse.json({ ok: true, reportId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
