// The resume sync's loop, with its I/O passed in so it can be tested without Figma or
// Notion: for each resume row, read its Figma frame, decide, and write at most one block.
//
// Order matters for safety:
//   1. A frame that does not read as a whole resume is never written anywhere.
//   2. A page whose text you edited in Notion is never overwritten.
//   3. The new block is appended before the old one is deleted (the writer does this).

import { decideSync, docText, emptyReport, fingerprint, looksLikeResume, mirrorBlock, resumeFromFigma, type FigmaNode, type FigmaRef, type MirrorState, type ResumeSyncReport } from "@/lib/domain/resumeSync";

export interface MirrorPorts {
  /** Frames of one Figma file by node id; null for a frame Figma did not return. */
  frames(fileKey: string, nodeIds: string[]): Promise<Record<string, FigmaNode | null>>;
  /** The containers Atlas owns on a page and the newest one's state. */
  mirror(pageId: string): Promise<{ blockIds: string[]; state: MirrorState | null }>;
  /** Appends the new container, then deletes the ones it replaces. With no block, only deletes. */
  write(pageId: string, block: Record<string, unknown> | null, replaces: string[]): Promise<void>;
  now?: () => number;
}

export interface MirrorSource {
  role: string;
  pageId: string;
  figma: FigmaRef | null;
}

export interface MirrorOutcome {
  report: ResumeSyncReport;
  /** Figma requests made, and Notion pages read and written: for the activity log. */
  counts: { files: number; frames: number; pagesRead: number; pagesWritten: number };
}

/**
 * Mirrors every linked resume. `deadline` (ms since epoch) stops new pages from being
 * started; anything not reached is reported as waiting and picked up by the next run.
 * Throws only when a read fails outright (Figma or Notion down, token refused): a partial
 * run is better reported as a failure than as "nothing changed".
 */
export async function mirrorResumes(sources: readonly MirrorSource[], ports: MirrorPorts, today: string, deadline: number): Promise<MirrorOutcome> {
  const now = ports.now ?? Date.now;
  const report = emptyReport();
  const counts = { files: 0, frames: 0, pagesRead: 0, pagesWritten: 0 };
  const linked = sources.filter((s): s is MirrorSource & { figma: FigmaRef } => s.figma !== null);
  report.unlinked = sources.filter((s) => s.figma === null).map((s) => s.role);

  // One request per Figma file, however many resumes it holds.
  const byFile = new Map<string, string[]>();
  for (const s of linked) byFile.set(s.figma.fileKey, [...(byFile.get(s.figma.fileKey) ?? []), s.figma.nodeId]);
  const frames = new Map<string, FigmaNode | null>();
  for (const [fileKey, ids] of byFile) {
    const got = await ports.frames(fileKey, [...new Set(ids)]);
    counts.files++;
    for (const id of ids) frames.set(`${fileKey}/${id}`, got[id] ?? null);
  }
  counts.frames = [...frames.values()].filter(Boolean).length;

  for (const s of linked) {
    if (now() > deadline) {
      report.waiting.push(s.role);
      continue;
    }
    const frame = frames.get(`${s.figma.fileKey}/${s.figma.nodeId}`) ?? null;
    const doc = frame ? resumeFromFigma(frame) : null;
    if (!looksLikeResume(doc)) {
      report.unreadable.push(s.role);
      continue;
    }
    const page = await ports.mirror(s.pageId);
    counts.pagesRead++;
    const decision = decideSync(fingerprint(docText(doc)), page.state);
    if (decision === "same") {
      report.unchanged++;
      // An older copy left behind by a delete that failed last time would be indexed twice.
      const leftovers = page.blockIds.slice(0, -1);
      if (leftovers.length > 0) await ports.write(s.pageId, null, leftovers).catch(() => undefined);
      continue;
    }
    if (decision === "kept") {
      report.kept.push(s.role);
      continue;
    }
    if (decision === "conflict") {
      report.conflicts.push(s.role);
      continue;
    }
    await ports.write(s.pageId, mirrorBlock(doc, today), page.blockIds);
    counts.pagesWritten++;
    report.updated.push(s.role);
  }
  return { report, counts };
}
