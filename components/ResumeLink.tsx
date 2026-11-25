import Link from "next/link";
import { resumePreviewHref, type PreviewFrom } from "@/lib/domain/resumeProof";
import { Icon } from "./Icon";

/**
 * "Resume: AI Engineer": which resume a job will use, by its target role. It opens the PDF
 * Notion holds for that role, inside Atlas, with a Back button to where you were.
 */
export function ResumeLink({ role, from }: { role: string; from: PreviewFrom }) {
  if (!role.trim()) return null;
  return (
    <Link href={resumePreviewHref(role, from)} className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-brand hover:underline md:min-h-0">
      <Icon name="copy" size={13} /> Resume: {role}
    </Link>
  );
}
