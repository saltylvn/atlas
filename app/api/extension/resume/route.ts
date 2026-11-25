import { NextResponse, type NextRequest } from "next/server";
import { roleResume } from "@/lib/applyResume";
import { audit } from "@/lib/audit";
import { careerPrefs } from "@/lib/agents/career";
import { previewRole, resumeFileName } from "@/lib/domain/resumeProof";
import { cors, extensionContext, preflight } from "@/lib/extensionApi";

// The resume PDF for a role, from the Resumes database in Notion, for Atlas Autofill to drop
// into a form's upload field. ?role=<target role>; without one, your first role's.
export const OPTIONS = preflight;
export async function GET(request: NextRequest) {
  const got = await extensionContext(request, "/api/extension/resume");
  if (got instanceof NextResponse) return got;
  const role = previewRole(request.nextUrl.searchParams.get("role") ?? undefined) || careerPrefs(got.ctx.settings).roles[0]?.name || "";
  const found = await roleResume(got.ctx, role, true);
  if (!found.ok || !found.bytes) return cors(request, NextResponse.json({ error: found.ok ? "The resume file was empty." : found.why }, { status: 404 }));
  await audit(got.ctx.store, { actor: "owner", action: "extension.resume", target: "pdf", detail: `${found.resume}, ${found.bytes.length} bytes`, outcome: "success" });
  const res = new NextResponse(Buffer.from(found.bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${resumeFileName(got.ctx.settings.careerAnswers?.fullName ?? "", found.resume)}"`, "x-resume-name": encodeURIComponent(resumeFileName(got.ctx.settings.careerAnswers?.fullName ?? "", found.resume)) },
  });
  res.headers.set("Access-Control-Expose-Headers", "x-resume-name");
  return cors(request, res);
}
