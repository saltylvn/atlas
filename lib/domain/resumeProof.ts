// Which Figma frame is the resume for a role, and whether a kept PDF is still that frame as
// you approved it (docs/design.md, 5.6). Pure.

import type { FigmaRef } from "./resumeSync";
import { canonicalRole } from "./targetRoles";
import type { ResumeProof } from "./types";

export interface FrameSource {
  /** The Resumes row's name: a target role, or "Master Resume". */
  role: string;
  figma: FigmaRef | null;
}

const key = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9+]+/g, " ").trim();

/**
 * The row for a role: the row named exactly for it, else a row whose old name folded into
 * it ("AI + Automation Engineer" holds the AI Automation Engineer resume), else the Master Resume.
 */
function rowFor<T extends { role: string }>(sources: readonly T[], role: string, has: (s: T) => boolean): T | undefined {
  const want = canonicalRole(role);
  return (
    sources.find((s) => key(s.role) === key(role) && has(s)) ??
    sources.find((s) => !/^master\b/i.test(s.role.trim()) && canonicalRole(s.role) === want && has(s)) ??
    sources.find((s) => /^master\b/i.test(s.role.trim()) && has(s))
  );
}

/**
 * The frame to send for a role: the role's own row, or a row whose old name folded into the
 * role; else the Master Resume. Says which row it used, so the review can show it.
 */
export function frameForRole(sources: readonly FrameSource[], role: string): { resume: string; figma: FigmaRef } | null {
  const own = rowFor(sources, role, (s) => Boolean(s.figma));
  return own?.figma ? { resume: own.role.replace(/\s*\([^)]*\)\s*/g, " ").trim(), figma: own.figma } : null;
}

/** Where an application's PDF is kept: one file per posting, named so a person can tell what it is. */
export const resumePath = (postingKey: string): string => `apply-${postingKey.replace(/[^a-z0-9:_.-]+/gi, "-").slice(0, 150)}.pdf`;

/** The file name the job board sees. */
export const resumeFileName = (fullName: string, resume: string): string =>
  `${(fullName || "Resume").replace(/[^A-Za-z0-9 ]+/g, "").trim().replace(/\s+/g, "_") || "Resume"}_${resume.replace(/[^A-Za-z0-9 +]+/g, "").trim().replace(/\s+/g, "_")}_Resume.pdf`.replace(/\+/g, "and");

/** A Resumes row with the PDF in its Resume file column. */
export interface FileSource {
  role: string;
  file: { name: string; url: string } | null;
}

/**
 * The resume file to send for a role: the role's own row, or a row whose old name folded into
 * the role; else the Master Resume. Only rows that hold a file count. Says which row it used,
 * so the review can show it.
 */
export function fileForRole<T extends FileSource>(sources: readonly T[], role: string): { resume: string; source: T & { file: NonNullable<T["file"]> } } | null {
  const own = rowFor(sources, role, (s) => Boolean(s.file));
  return own?.file ? { resume: own.role.replace(/\s*\([^)]*\)\s*/g, " ").trim(), source: own as T & { file: NonNullable<T["file"]> } } : null;
}

export type ProofCheck = { ok: true } | { ok: false; why: string };

/**
 * Right before submitting: the file about to be attached must be the very file you approved,
 * and the source (the file in Notion) must still be the one it was copied from. `frameFingerprint`
 * is the source's fingerprint now, or null when the source could not be read.
 */
export function checkProof(proof: ResumeProof | undefined, now: { frameFingerprint: string | null; pdfSha256: string | null }): ProofCheck {
  const where = proof?.from === "notion" ? "Notion" : "Figma";
  if (!proof) return { ok: false, why: "The resume has no record of where it came from. Prepare this application again." };
  if (now.pdfSha256 !== proof.pdfSha256) return { ok: false, why: "The kept resume PDF is not the file you approved. Prepare this application again." };
  if (now.frameFingerprint === null) return { ok: false, why: `${where} could not be read to confirm the resume is current. Nothing was sent; try again.` };
  if (now.frameFingerprint !== proof.frameFingerprint) return { ok: false, why: `Your ${proof.resume} resume changed in ${where} since you approved. Prepare it again so the new version is sent.` };
  return { ok: true };
}

/** How the review describes the resume that will be sent. */
export function proofLine(p: ResumeProof, role: string): string {
  const which = p.resume.toLowerCase() === role.toLowerCase() ? `your ${p.resume} resume` : `your ${p.resume} resume (no file of its own for ${role})`;
  const from = p.from === "notion" ? `from Notion${p.fileName ? ` (${p.fileName})` : ""}, copied` : "exported from Figma";
  return `Sends ${which}, ${from} ${p.exportedAt.slice(0, 16).replace("T", " ")} UTC; ${Math.round(p.bytes / 1024)} KB; fingerprint ${p.pdfSha256.slice(0, 12)}.`;
}

/** The frame's own link in Figma, to open it beside the PDF. */
export const frameLink = (p: Pick<ResumeProof, "fileKey" | "nodeId">): string => `https://www.figma.com/design/${p.fileKey}/?node-id=${p.nodeId.replace(":", "-")}`;

/** Where a resume preview was opened from, and so where its Back button returns. A fixed list: the link never carries an address. */
export const PREVIEW_BACK = { brief: "/", fits: "/career#fits", queue: "/career#apply-lane", mac: "/career#approvals" } as const;
export type PreviewFrom = keyof typeof PREVIEW_BACK;

/** The in-app page that shows the resume Notion holds for a role right now. */
export const resumePreviewHref = (role: string, from: PreviewFrom): string => `/career/resume?role=${encodeURIComponent(role.slice(0, 80))}&from=${from}`;

/** A target role's name as it may appear in a link: letters, digits, spaces and a few marks, at most 80. */
export const previewRole = (raw: string | undefined): string => (raw && /^[\p{L}\p{N} .,&+/()'-]{1,80}$/u.test(raw.trim()) ? raw.trim() : "");
