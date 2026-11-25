import { NextResponse, type NextRequest } from "next/server";
import { answerForm } from "@/lib/agents/extensionAnswers";
import { audit } from "@/lib/audit";
import { FormRequest } from "@/lib/domain/extensionForm";
import { cors, extensionContext, preflight } from "@/lib/extensionApi";

// Atlas Autofill sends the questions of the form you are looking at; the Apply Agent answers
// what it may (lib/agents/extensionAnswers.ts). Nothing is sent or submitted from here.
export const maxDuration = 60;
export const OPTIONS = preflight;

export async function POST(request: NextRequest) {
  const got = await extensionContext(request, "/api/extension/answers");
  if (got instanceof NextResponse) return got;
  const raw = await request.json().catch(() => null);
  const p = FormRequest.safeParse(raw);
  if (!p.success) return cors(request, NextResponse.json({ error: "The form could not be read. Reload the page and try again." }, { status: 400 }));
  try {
    const out = await answerForm(got.ctx, got.persist, p.data);
    let host = "";
    try {
      host = new URL(p.data.url).hostname.slice(0, 120);
    } catch {
      host = "";
    }
    await audit(got.ctx.store, { actor: "owner", action: "extension.answers", target: host || "a page", detail: `${p.data.questions.length} questions`, outcome: "success" });
    return cors(request, NextResponse.json(out));
  } catch {
    return cors(request, NextResponse.json({ error: "Atlas could not answer this form just now. Try again." }, { status: 500 }));
  }
}
