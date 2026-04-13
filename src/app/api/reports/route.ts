import { NextResponse } from "next/server";
import { createJustDbReport } from "@/lib/justdb";

/**
 * 報告書登録API。
 * フロントから受け取った入力を検証し、JUST.DBへ転送する。
 */
export async function POST(request: Request) {
  try {
    const json = await request.json();
    await createJustDbReport(json);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
