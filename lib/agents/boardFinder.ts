import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { boardsInHtml, candidateSlugs, domainOf, pickCareersPage, type BoardCheck, type FoundBoard } from "@/lib/domain/boardFinder";
import { countReads, readsLeft } from "@/lib/domain/postingFacts";
import { regionOf } from "@/lib/domain/techMarket";
import { JOB_BOARDS, type JobBoard } from "@/lib/domain/types";
import { mapSite, readHtml, READ_HELP } from "@/lib/integrations/firecrawl";
import { probeBoard, type Raw } from "@/lib/integrations/jobBoards";
import { logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Scout's board finder, on demand from the Data Pipeline page. Rules first, Firecrawl last:
// free guesses on the six board APIs; only when none answers, and you gave a website, Firecrawl
// maps the site (1 credit) and reads the careers page's HTML (1 credit). Both count against the
// same monthly Firecrawl budget as posting reads. Nothing is added to the watchlist here: you
// press Watch on what it found.

export const FINDER_TASK = "Find a company's job board";

export interface FinderResult {
  company: string;
  found: BoardCheck[];
  /** What it did, step by step, for the page. */
  notes: string[];
  credits: number;
}

export interface FinderDeps {
  probe?: typeof probeBoard;
  map?: typeof mapSite;
  read?: typeof readHtml;
}

const check = (f: FoundBoard, jobs: Raw[]): BoardCheck => ({
  ...f,
  jobs: jobs.length,
  us: jobs.filter((j) => regionOf(j.location, false) !== null).length,
  utah: jobs.filter((j) => regionOf(j.location, false) === "utah").length,
});

export async function findBoards(ctx: Context, input: { company: string; website: string }, deps: FinderDeps = {}): Promise<FinderResult> {
  const probe = deps.probe ?? probeBoard;
  const runId = randomUUID();
  const t = tracer();
  const notes: string[] = [];
  let credits = 0;
  await logRun(ctx, { runId, agent: "scout", task: FINDER_TASK, status: "started", trigger: "owner", detail: input.company.slice(0, 80), ...NO_MODEL });
  const domain = input.website ? domainOf(input.website) : null;
  const found: BoardCheck[] = [];

  // 1. Guesses, free: each likely board name on every board, one name at a time.
  const slugs = candidateSlugs(input.company, domain).slice(0, 3);
  await t.step(
    "Try likely board names",
    async () => {
      for (const slug of slugs) {
        const hits = await Promise.all(JOB_BOARDS.map(async (board: JobBoard) => ({ board, jobs: await probe({ board, slug }) })));
        for (const h of hits) if (h.jobs) found.push(check({ board: h.board, slug, via: "guess" }, h.jobs));
        if (found.length) break;
      }
      return found.length;
    },
    (n) => `${slugs.join(", ")}: ${n} board${n === 1 ? "" : "s"} found`,
  );
  notes.push(found.length ? `Found by trying ${slugs.join(", ")} on the eight job-board systems (free).` : `No board answered to ${slugs.join(", ") || "the name"} (free check).`);

  // 2 and 3. Firecrawl, only when the guesses found nothing and a website was given.
  if (!found.length && domain) {
    const left = readsLeft(ctx.settings.firecrawlUsage, ctx.today);
    if (left.left < 2) notes.push(`Firecrawl not used: ${left.why}.`);
    else {
      const map = await t.step("Map the website for its careers page", () => (deps.map ?? mapSite)(`https://${domain}`, "careers jobs"), (r) => (r.ok ? `${r.links.length} pages` : READ_HELP[r.problem]));
      if (map.ok) credits++;
      const page = (map.ok ? pickCareersPage(map.links, domain) : null) ?? `https://${domain}/careers`;
      const html = await t.step("Read the careers page", () => (deps.read ?? readHtml)(page), (r) => (r.ok ? `${Math.round(r.html.length / 1024)} KB read` : READ_HELP[r.problem]));
      if (html.ok) credits++;
      const linked = html.ok ? boardsInHtml(html.html) : [];
      for (const f of linked) {
        const jobs = await probe(f);
        if (jobs) found.push(check(f, jobs));
      }
      notes.push(html.ok ? (found.length ? `Found on ${page} (Firecrawl, ${credits} credits).` : `${page} links to no board Atlas can read: it may be a custom careers page (Firecrawl, ${credits} credits).`) : `Could not read ${page}: ${READ_HELP[html.problem]}`);
      if (credits) await ctx.store.settings.update({ firecrawlUsage: countReads(ctx.settings.firecrawlUsage, ctx.today, credits) });
    }
  } else if (!found.length) notes.push("Add the company's website to let Firecrawl look for its careers page.");

  const headline = found.length ? `${input.company}: ${found.map((f) => `${f.board}/${f.slug} (${f.jobs} jobs)`).join(", ")}` : `${input.company}: no board found`;
  await logRun(ctx, { runId, agent: "scout", task: FINDER_TASK, status: "succeeded", trigger: "owner", detail: `${headline}${credits ? `; ${credits} Firecrawl credits` : ""}`.slice(0, 300), ...NO_MODEL, ...t.finish() });
  return { company: input.company, found: found.slice(0, 4), notes, credits };
}
