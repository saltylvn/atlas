// The data pipeline as Mission Control's Pipeline view draws it: every stage from the job
// sources to the Market page, with its count from the latest Scout run, how fresh it is, and
// the data-quality checks. Pure: the latest run's quality record and a few counts in.

import { JOB_SOURCES } from "./jobSources";
import { TECH_KEEP_DAYS, type RunQuality } from "./techMarket";
import type { LocalDate } from "./types";

export interface Stage {
  id: string;
  label: string;
  /** What happens at this stage, in a few words. */
  what: string;
  count: number | null;
  /** The table or page it lands in, when it is stored. */
  store?: string;
  /** Postings set aside at this stage, by reason. */
  dropped?: { reason: string; n: number }[];
  /** Where this stage's postings flow next, when it splits them (your six roles). */
  lanes?: { label: string; n: number }[];
  warn?: string;
}

export interface SourceRow {
  name: string;
  read: number;
  tech: number;
  withPay: number;
  ok: boolean;
  /** Not read this run by design (a keyed, once-a-day source). Left out of "sources answering". */
  idle: boolean;
}

export interface QualityCheck {
  label: string;
  value: number;
  /** Below this share the check is flagged. */
  floor: number;
  ok: boolean;
  why: string;
}

export interface PipelineView {
  lastRun: LocalDate | null;
  fresh: boolean;
  sources: SourceRow[];
  stages: Stage[];
  checks: QualityCheck[];
  yours: { postings: number; reportDay: LocalDate | null };
}

const share = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function pipelineView(input: { quality: RunQuality | null; size: { postings: number; days: number }; today: LocalDate; yourPostings: number; reportDay: LocalDate | null; floors?: { pay: number; skills: number; level: number; sources: number }; lens?: { rows: { label: string; n: number }[]; inRoles: number; other: number } }): PipelineView {
  // Your floors from the Data Pipeline page; these defaults until you set them.
  const fl = input.floors ?? { pay: 0.25, skills: 0.5, level: 0.25, sources: 0.75 };
  const q = input.quality;
  const byName = new Map((q?.sources ?? []).map((s) => [s.source, s]));
  const sources: SourceRow[] = JOB_SOURCES.map((src) => {
    const s = byName.get(src.name);
    // A keyed source (Adzuna) is read once a day, and only with its key: 0 then means "not this run", not "down".
    return { name: src.name, read: s?.read ?? 0, tech: s?.tech ?? 0, withPay: s?.withPay ?? 0, ok: (s?.read ?? 0) > 0, idle: Boolean(src.keyed) && (s?.read ?? 0) === 0 };
  });
  const stages: Stage[] = [
    { id: "read", label: "Read", what: `Postings the Scout read from ${sources.filter((s) => s.ok).length} of ${sources.filter((s) => !s.idle).length} sources`, count: q?.read ?? null },
    {
      id: "filter",
      label: "Tech, full-time, U.S.",
      what: "Labeled with a role family, level, work mode, region and yearly pay",
      count: q?.tech ?? null,
      dropped: q ? [{ reason: "not a tech role", n: q.notTech }, { reason: "contract or part-time", n: q.notFullTime }, { reason: "outside the U.S.", n: q.outsideUs }] : undefined,
    },
    {
      id: "dedupe",
      label: "Duplicates merged",
      what: "The same company, title and region from two sources is one job",
      count: q?.recorded ?? null,
      dropped: q ? [{ reason: "same job from another source", n: q.duplicates }] : undefined,
      ...(q?.capped ? { warn: "The run hit its 4,000-row cap: some postings were not recorded." } : {}),
    },
    { id: "store", label: "Stored", what: `Every tech job, kept ${TECH_KEEP_DAYS} days after it was last seen`, count: input.size.postings, store: "tech_postings" },
    ...(input.lens
      ? [
          {
            id: "roles",
            label: "Your six roles",
            what: "The last 30 days of jobs, sorted by title into Software, Automation, Workflow, Solutions, Agentic and Forward Deployed Engineer",
            count: input.lens.inRoles,
            lanes: [...input.lens.rows].sort((a, b) => b.n - a.n),
            dropped: [{ reason: "other tech roles", n: input.lens.other }],
          },
        ]
      : []),
    { id: "summary", label: "Daily summary", what: "Active, new and gone postings and median pay per day, role family, level and region; kept for good", count: input.size.days, store: "market_daily" },
    { id: "page", label: "Market page", what: "The snapshot you read", count: null, store: "/career/market" },
  ];
  const n = q?.recorded ?? 0;
  const checks: QualityCheck[] = q
    ? [
        { label: "States pay", value: share(q.withPay, n), floor: fl.pay, ok: share(q.withPay, n) >= fl.pay, why: "Median pay rests on these postings." },
        { label: "Names a skill", value: share(q.withSkills, n), floor: fl.skills, ok: share(q.withSkills, n) >= fl.skills, why: "Skill demand rests on these. SmartRecruiters, Workable, Recruitee and BambooHR boards give titles only." },
        { label: "States a level", value: share(q.levelStated, n), floor: fl.level, ok: share(q.levelStated, n) >= fl.level, why: "Pay by level rests on these." },
        { label: "Sources answering", value: share(sources.filter((s) => s.ok).length, sources.filter((s) => !s.idle).length), floor: fl.sources, ok: share(sources.filter((s) => s.ok).length, sources.filter((s) => !s.idle).length) >= fl.sources, why: "A source that stops answering skews the sample." },
      ]
    : [];
  return { lastRun: q?.day ?? null, fresh: q?.day === input.today, sources, stages, checks, yours: { postings: input.yourPostings, reportDay: input.reportDay } };
}
