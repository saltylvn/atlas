import "server-only";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import type { Context } from "@/lib/context";
import { demoResumeFiles } from "@/lib/data/demoResumeFiles";
import { fileForRole, resumeFileName } from "@/lib/domain/resumeProof";
import { downloadResumeFile, NotionError, readResumeSources } from "@/lib/integrations/notion";
import { rateLimit } from "@/lib/security/rateLimit";

// Serves the resume PDF Notion holds for a target role, for the in-app preview. Owner only
// (the caller went through getContext). Read-only.

const plain = (status: number, text: string) => new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export type RoleResume = { ok: true; resume: string; bytes?: Uint8Array } | { ok: false; why: string };

/**
 * Which resume Atlas will use for a role, read from the Resumes database in Notion now: the
 * role's own row, else the one its notes point to, else the Master Resume. With `withFile`
 * the PDF itself is fetched too. Read-only. The demo answers with its sample resume.
 */
export async function roleResume(ctx: Pick<Context, "settings" | "mode">, role: string, withFile: boolean): Promise<RoleResume> {
  try {
    const demo = ctx.mode === "live" ? null : demoResumeFiles([role]);
    const sources = demo?.sources ? await demo.sources() : await readResumeSources(ctx.settings.notionResumesId);
    const pick = fileForRole(sources, role);
    if (!pick) return { ok: false, why: "No resume PDF in Notion for this role. Put the PDF in the Resume file column of its row (or the Master Resume's) in the Resumes database." };
    if (!withFile) return { ok: true, resume: pick.resume };
    return { ok: true, resume: pick.resume, bytes: await (demo?.download ?? downloadResumeFile)(pick.source.file) };
  } catch (err) {
    // Fixed text only: nothing from Notion's reply is echoed.
    if (err instanceof NotionError) return { ok: false, why: err.problem === "not_configured" ? "Notion is not set up yet, so there is no resume to show." : err.problem === "bad_request" ? "The file in Notion's Resume file column is not a PDF." : "The resume could not be read from Notion just now. Try again in a minute." };
    return { ok: false, why: "The resume could not be read from Notion just now. Try again in a minute." };
  }
}

/** Serves the PDF Notion holds for a role right now, for the in-app preview. Owner only (the caller went through getContext). */
export async function roleResumeResponse(ctx: Context, role: string): Promise<NextResponse> {
  if (!role) return plain(400, "No role was named.");
  if (!rateLimit("resume-preview", 30, 10 * 60_000).allowed) return plain(429, "Opened a lot of resumes just now. Try again in a few minutes.");
  const found = await roleResume(ctx, role, true);
  if (!found.ok || !found.bytes) return plain(404, found.ok ? "The resume file was empty." : found.why);
  await audit(ctx.store, { actor: "owner", action: "apply.resume-previewed", target: "pdf", detail: `${found.resume}, ${found.bytes.length} bytes`, outcome: "success" });
  return new NextResponse(Buffer.from(found.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${resumeFileName(ctx.settings.careerAnswers?.fullName ?? "", found.resume)}"`,
      "content-length": String(found.bytes.length),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
