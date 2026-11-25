import Link from "next/link";
import { getContext } from "@/lib/context";
import { ResumeFrame } from "@/components/client/ResumeFrame";
import { roleResume } from "@/lib/applyResume";
import type { Context } from "@/lib/context";
import { PREVIEW_BACK, previewRole, resumeFileName, type PreviewFrom } from "@/lib/domain/resumeProof";

export const metadata = { title: "Resume PDF" };

function BackButton({ href }: { href: string }) {
  return (
    <Link href={href} className="btn btn-primary">
      <span aria-hidden="true">←</span> Back
    </Link>
  );
}

/**
 * The resume PDF, shown inside Atlas. An installed phone app has no browser bar, so a PDF
 * opened by itself leaves no way back; here the Back button is always on screen. With
 * `?role=<name>` it shows the PDF Notion holds for that role right now.
 */
export default async function ResumePdfPage({ searchParams }: { searchParams: Promise<{ role?: string; from?: string }> }) {
  const ctx = await getContext();
  const { role: rawRole, from = "" } = await searchParams;
  const back = PREVIEW_BACK[from as PreviewFrom] ?? PREVIEW_BACK.fits;
  const previewOf = previewRole(rawRole);
  if (previewOf) return <RolePreview ctx={ctx} role={previewOf} back={back} />;
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-line p-3 text-sm text-ink-2" role="status">
        No role was named. Open a resume from a job in Good fits or the Apply Queue, or from{" "}
        <Link href="/roles" className="font-medium text-brand hover:underline">
          Target roles
        </Link>
        .
      </p>
      <BackButton href={back} />
    </div>
  );
}

/** The resume a job for this role will use, as Notion holds it now, before any application is prepared. */
async function RolePreview({ ctx, role, back }: { ctx: Context; role: string; back: string }) {
  const found = await roleResume(ctx, role, false);
  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas px-1 py-2">
        <BackButton href={back} />
        <h1 className="h-display min-w-0 flex-1 text-[1rem] font-semibold break-words">{found.ok ? resumeFileName(ctx.settings.careerAnswers?.fullName ?? "", found.resume) : "Resume PDF"}</h1>
      </div>
      {found.ok ? (
        <>
          <p className="text-xs text-ink-2 break-words">
            For a {role} job Atlas uses your {found.resume} resume{found.resume.toLowerCase() === role.toLowerCase() ? "" : `, because the ${role} row in Notion holds no PDF of its own`}. This is the file in Notion right now.
          </p>
          {/* US Letter: the file is not measured here, it is only shown. */}
          <ResumeFrame src={`/api/apply/resume?role=${encodeURIComponent(role)}`} width={612} height={792} />
          <p className="text-xs text-ink-3">When Atlas prepares an application it keeps a copy of this file, and that kept copy is the one you approve and the one sent. Change the PDF in Notion and later jobs use the new one.</p>
        </>
      ) : (
        <p className="rounded-lg border border-line p-3 text-sm text-ink-2" role="status">
          {found.why}
        </p>
      )}
      <BackButton href={back} />
    </div>
  );
}
