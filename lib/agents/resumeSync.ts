import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { syncSummary, type ResumeSyncReport } from "@/lib/domain/resumeSync";
import type { AgentRunEvent } from "@/lib/domain/types";
import { FigmaError, figmaConfigured, readFigmaFrames } from "@/lib/integrations/figma";
import { NotionError, NOTION_WRITE_HELP, notionConfigured, readPageMirror, readResumeSources, writePageMirror } from "@/lib/integrations/notion";
import { indexKnowledge, indexNote } from "@/lib/knowledge/indexer";
import { mirrorResumes } from "@/lib/knowledge/resumeMirror";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Applications Agent's resume sync. Once a day, about 6 PM: if a resume changed in
// Figma, its text is mirrored into that role's page in Notion and indexed for Ask Atlas.
//
// Reads Figma (read-only token) and the Resumes database. Writes one thing: the callout
// block Atlas owns on each resume page. No model is called, so it costs nothing and sends
// your resume to no AI service. Your contact details are left out of the mirrored text.

/** The activity-log task name. */
export const RESUME_SYNC_TASK = "Resume sync (Figma to Notion)";

/** Leaves the rest of the evening run (the Mentor) its share of the request's 60 seconds. */
const SYNC_WINDOW_MS = 22_000;

export interface ResumeSyncOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  /** Where the search index is written: the service store on a schedule, your session otherwise. */
  persist: Store;
}

export interface ResumeSyncResult {
  report: ResumeSyncReport;
  headline: string;
}

/** Whether both ends are set up. The schedule stays silent until they are. */
export const resumeSyncReady = (): boolean => notionConfigured() && figmaConfigured();

export async function runResumeSync(ctx: Context, opts: ResumeSyncOptions): Promise<ResumeSyncResult | AgentMissing> {
  const agent = "career" as const;
  const runId = randomUUID();
  const task = RESUME_SYNC_TASK;
  const { trigger, persist } = opts;
  if (ctx.mode !== "live" || !resumeSyncReady()) {
    return { missing: "skipped", why: !notionConfigured() ? "Notion is not set up yet: add NOTION_TOKEN in Vercel." : "Figma is not set up yet: add FIGMA_TOKEN in Vercel, then redeploy." };
  }
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const started = Date.now();
  try {
    const sources = await t.step("Read the Resumes rows and their Figma links", () => readResumeSources(ctx.settings.notionResumesId), (s) => `${s.length} rows, ${s.filter((x) => x.figma).length} with a Figma link`);
    const { report } = await t.step(
      "Compare each Figma resume with its Notion page",
      () => mirrorResumes(sources, { frames: readFigmaFrames, mirror: readPageMirror, write: writePageMirror }, ctx.today, started + SYNC_WINDOW_MS),
      (o) => `${o.counts.frames} frames read from ${o.counts.files} file${o.counts.files === 1 ? "" : "s"}, ${o.counts.pagesRead} pages checked, ${o.counts.pagesWritten} written`,
    );
    // New text is searchable the same evening. A slow index never fails the sync: the next
    // 2-hour sync finishes it.
    if (report.updated.length > 0) {
      await t
        .step("Index the new resume text", () => indexKnowledge(persist, ctx.settings.timezone, new Date(), { embedBudget: 24, deadline: Date.now() + 10_000 }), indexNote)
        .catch(() => undefined);
    }
    const headline = syncSummary(report);
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail: headline, ...NO_MODEL, ...t.finish() });
    return { report, headline };
  } catch (err) {
    // Fixed text only: nothing from Figma's or Notion's reply is echoed.
    const why =
      err instanceof NotionError
        ? err.problem === "forbidden"
          ? NOTION_WRITE_HELP
          : err.message
        : err instanceof FigmaError
          ? err.message
          : "The resume sync failed unexpectedly. The next run will try again.";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
