import type { NextRequest } from "next/server";
import { roleResumeResponse } from "@/lib/applyResume";
import { getContext } from "@/lib/context";
import { previewRole } from "@/lib/domain/resumeProof";

// A resume PDF, shown inside Atlas. Gated by proxy.ts and again by getContext (owner + MFA).
// ?role=<name>: the file Notion holds for that target role right now, so you can see which
//   resume a job will use. Read-only.
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const role = previewRole(request.nextUrl.searchParams.get("role") ?? undefined);
  return roleResumeResponse(ctx, role ?? "");
}
