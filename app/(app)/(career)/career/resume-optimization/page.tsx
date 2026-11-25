import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { addDays } from "@/lib/domain/dates";
import { lengthNote, resumeScorecards, resumeTexts, SCORE_DAYS, type ResumeScorecard } from "@/lib/domain/resumeScore";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Resume Optimization" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const tone = (score: number) => (score >= 75 ? "var(--c-green)" : score >= 55 ? "var(--c-warn)" : "var(--c-red)");

/** One resume against what its role's postings ask for. */
function Scorecard({ c }: { c: ResumeScorecard }) {
  const missing = c.keywords.filter((k) => !k.onResume);
  const easy = missing.filter((k) => k.haveElsewhere);
  const gaps = missing.filter((k) => !k.haveElsewhere);
  return (
    <section className="card card-pad space-y-4" aria-labelledby={`resume-${c.name}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`resume-${c.name}`} className="h-display text-lg font-medium break-words">
            {c.name}
          </h2>
          <p className="text-xs text-ink-3">
            Measured against {c.postings.toLocaleString()} {c.against} postings from the last {SCORE_DAYS} days
          </p>
        </div>
        <Pill color={tone(c.score)}>{c.score} / 100</Pill>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="eyebrow mb-2">Keywords postings ask for · {pct(c.coverage)} covered</h3>
          {c.keywords.length === 0 ? (
            <p className="text-sm text-ink-3">No postings for this role name skills yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills postings ask for, most asked first">
              {c.keywords.map((k) => (
                <li key={k.skill} className="chip" title={`${k.skill}: in ${pct(k.share)} of postings; ${k.onResume ? "on this resume" : k.haveElsewhere ? "missing here, but you have it" : "missing"}`}>
                  <span aria-hidden="true">{k.onResume ? "✓" : k.haveElsewhere ? "+" : "·"}</span> {k.skill} <span className="text-ink-3">{pct(k.share)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-3">✓ on this resume · + you have it elsewhere: an easy add · · a gap to learn or build</p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-ink-2">Easy adds</dt>
          <dd className="break-words">{easy.length ? easy.map((k) => k.skill).join(", ") : "None: every skill you have is on it"}</dd>
          <dt className="text-ink-2">Gaps</dt>
          <dd className="break-words">{gaps.length ? gaps.slice(0, 6).map((k) => k.skill).join(", ") : "None in the top 20"}</dd>
          <dt className="text-ink-2">Headline</dt>
          <dd>{c.headline.ok ? `Names the role (${c.headline.wanted})` : `Add "${c.headline.wanted}" near the top`}</dd>
          <dt className="text-ink-2">Numbers</dt>
          <dd>
            {c.bullets.quantified} of {c.bullets.lines} bullets carry a number{c.bullets.lines && c.bullets.quantified / c.bullets.lines < 0.6 ? ": aim for 6 in 10" : ""}
          </dd>
          <dt className="text-ink-2">Length</dt>
          <dd>{lengthNote(c.words)}</dd>
        </dl>
      </div>

      {c.bullets.weak.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1">Weak openings to rewrite</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {c.bullets.weak.map((l) => (
              <li key={l} className="break-words">
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function ResumeOptimizationPage() {
  const ctx = await getContext();
  const { store, today, settings } = ctx;
  const [rows, postings] = await Promise.all([store.knowledge.bySource("resume", 400).catch(() => []), store.techMarket.since(addDays(today, -SCORE_DAYS)).catch(() => [])]);
  const cards = resumeScorecards(resumeTexts(rows), { postings, today, mySkills: settings.careerSkills ?? [], roleOrder: careerPrefs(settings).roles.map((r) => r.name) });

  return (
    <div className="space-y-5">
      <PageHeader title="Resume Optimization" sub="Each resume from Figma, measured against what its role's job postings ask for. The Career Mentor's suggested edits come next; you make every change in Figma." />
      <section className="card card-pad">
        <CardHeader
          title="How the score works"
          icon="sparkle"
          hint={`Keywords 50, numbers in bullets 20, no weak openings 10, headline 10, length 10. Resumes are read from the text the Monday sync copies from Figma to Notion, and postings are every job of the last ${SCORE_DAYS} days in that role.`}
        />
      </section>
      {cards.length === 0 ? (
        <Empty>
          No resume text yet. It is read from Figma each Monday; set up the resume sync under <Link href="/career/setup">Setup</Link>.
        </Empty>
      ) : (
        cards.map((c) => <Scorecard key={c.name} c={c} />)
      )}
    </div>
  );
}
