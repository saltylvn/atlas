import { NextResponse, type NextRequest } from "next/server";
import { cors, extensionContext, preflight } from "@/lib/extensionApi";

// Atlas Autofill checks its key here when you connect it. Says only that it works, and whose name to greet.
export const OPTIONS = preflight;
export async function GET(request: NextRequest) {
  const got = await extensionContext(request, "/api/extension/ping");
  if (got instanceof NextResponse) return got;
  const first = (got.ctx.settings.careerAnswers?.fullName ?? got.ctx.settings.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return cors(request, NextResponse.json({ ok: true, name: first.slice(0, 40) }));
}
