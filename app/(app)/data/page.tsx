import Link from "next/link";
import { mentorInput } from "@/lib/agents/dataMentor";
import { aiConfigured, aiName } from "@/lib/ai/model";
import { getContext } from "@/lib/context";
import { currentStep, setupSteps, type StepId } from "@/lib/domain/dataPipeline";
import { shortDate } from "@/lib/domain/dates";
import { JOB_SOURCES } from "@/lib/domain/jobSources";
import { KindPill } from "@/components/KindBadges";
import { Icon } from "@/components/Icon";
import { Avatar, CardHeader, PageHeader, Pill } from "@/components/ui";
import { AGENTS } from "@/lib/domain/agents";
import { DetailModeSelect, FloorsForm, MarkStepButton, MentorButton, SourceSwitch } from "@/components/client/DataPipelineControls";
import { BoardFinder } from "@/components/client/BoardFinder";
import { DataMap } from "@/components/client/DataMap";
import { PipelineView } from "@/components/PipelineView";
import { loadPipeline } from "@/lib/agents/dataMapLoad";
import { RoleLens } from "@/components/RoleLens";

export const metadata = { title: "Data Pipeline" };
// The mentor's model call runs inside this request.
export const maxDuration = 60;

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Who works on the job-market data, in their colors: a Career bot wears orange; AI judgment is pink. */
const WORKERS: readonly { id: string; name: string; ai: boolean; does: string }[] = [
  { id: "scout", name: "Scout", ai: false, does: "reads the sources, cleans and stores postings · rules only" },
  { id: "analyst", name: "Analyst", ai: true, does: "sorts titles the rules cannot place, writes the market report" },
  { id: "mentor", name: "Career Mentor", ai: true, does: "the Career Map, and the Data Mentor beside your setup" },
];

/** What each step's one action is. */
function StepAction({ id, reviewed, children }: { id: StepId; reviewed: boolean; children?: React.ReactNode }) {
  switch (id) {
    case "watchlist":
      return (
        <div className="space-y-3">
          <BoardFinder />
          <Link href="/jobs" className="btn btn-ghost btn-sm min-h-11 h-auto whitespace-normal text-left">            <Icon name="plus" size={14} /> Or pick from the Utah suggestions on Setup
          </Link>
        </div>
      );
    case "benchmarks":
    case "adzuna":
      return (
        <div className="space-y-2 text-sm text-ink-2">
          <p>
            Add the key in Vercel: Project → Settings → Environment Variables, marked Sensitive, for Production and Preview.{" "}
            {id === "benchmarks" ? (
              <>
                FRED: <code className="text-xs">FRED_API_KEY</code>, free at fred.stlouisfed.org.
              </>
            ) : (
              <>
                Adzuna: <code className="text-xs">ADZUNA_APP_ID</code> and <code className="text-xs">ADZUNA_APP_KEY</code>, free at developer.adzuna.com. Atlas then makes 4 searches a day at the first sync, and credits Adzuna wherever its data appears.
              </>
            )}{" "}
            Keys are never entered in Atlas.
          </p>
          {id === "adzuna" && <MarkStepButton step="adzuna" reviewed={reviewed} label="Skip for now" />}
        </div>
      );
    default:
      return <>{children}</>;
  }
}

export default async function DataPipelinePage() {
  const ctx = await getContext();
  const [input, { view, map, lens, historyDays }] = await Promise.all([mentorInput(ctx), loadPipeline(ctx)]);
  const { config, quality } = input;
  const steps = setupSteps(input);
  const now = currentStep(steps);
  const done = steps.filter((s) => s.done).length;
  const review = config.review;
  const aiOn = aiConfigured() && ctx.settings.aiEnabled && ctx.settings.outboundEnabled;
  const bySource = new Map((quality?.sources ?? []).map((s) => [s.source, s]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Pipeline"
        sub="Set up the job-market data one step at a time, with the Data Mentor beside you. What you change here applies from the next 2-hour sync."
        action={
          <Link href="#setup" className="btn btn-ghost btn-sm min-h-11">
            <Icon name="settings" size={14} /> Set it up
          </Link>
        }
      />

      {/* The pipeline first (owner's layout, 24 Nov 2026): drawn like Mission Control, in Atlas's colors, with who works on it. */}
      <section aria-labelledby="data-map" className="space-y-3">
        <h2 id="data-map" className="h-display font-medium">
          The pipeline
        </h2>
        <ul aria-label="Who works on this data" className="flex flex-wrap gap-2">
          {WORKERS.map((w) => {
            const bot = AGENTS.find((a) => a.id === w.id);
            return (
              <li key={w.id} className="flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 text-sm" style={{ borderColor: w.ai ? "var(--c-ai)" : bot?.color ?? "var(--line)" }}>
                {bot && <Avatar initials={bot.initials} color={bot.color} size={26} />}
                <span className="font-medium">{w.name}</span>
                <KindPill kind="bot" />
                {w.ai && <Pill color="var(--c-ai)">AI</Pill>}
                <span className="hidden text-xs text-ink-3 lg:inline">{w.does}</span>
              </li>
            );
          })}
        </ul>
        <DataMap nodes={map.nodes} edges={map.edges} maxFlow={map.maxFlow} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="card card-pad min-w-0" aria-labelledby="setup">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="setup" className="h-display font-medium">
              Setup, one step at a time
            </h2>
            <span className="text-xs text-ink-3">
              {done} of {steps.length} done
            </span>
          </div>
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => {
              const open = now?.id === s.id;
              return (
                <li key={s.id} className={`rounded-xl border p-3 ${open ? "border-line-strong" : "border-line"}`} aria-current={open ? "step" : undefined}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${s.done ? "bg-brand-soft text-brand" : open ? "bg-ink text-canvas" : "bg-surface-2 text-ink-3"}`}>
                      {s.done ? <Icon name="check" size={13} /> : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {s.title}
                        {s.optional && <span className="ml-2 text-xs font-normal text-ink-3">optional</span>}
                        <span className="sr-only">{s.done ? " (done)" : open ? " (current step)" : ""}</span>
                      </p>
                      <p className="text-xs text-ink-3">{s.now}</p>
                      {open && (
                        <div className="mt-3 space-y-3">
                          <p className="text-sm text-ink-2">{s.why}</p>
                          <StepAction id={s.id} reviewed={config.reviewed.includes(s.id)}>
                            {s.id === "details" && <DetailModeSelect mode={config.details} />}
                            {s.id === "sources" && (
                              <div className="space-y-2">
                                <p className="text-sm text-ink-2">Turn sources on or off in the Sources panel, then mark this step done.</p>
                                <MarkStepButton step="sources" reviewed={config.reviewed.includes("sources")} label="I have reviewed my sources" />
                              </div>
                            )}
                            {s.id === "floors" && <FloorsForm floors={config.floors} cap={config.companyCap} />}
                          </StepAction>
                          <MentorButton focus={s.id} label="Ask the mentor about this step" />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {!now && <p className="mt-3 text-sm text-ink-2">Every step is done. Ask the mentor for a review whenever the numbers move.</p>}
        </section>

        <section className="card card-pad" aria-labelledby="mentor">
          <div className="flex items-start justify-between gap-2">
            <h2 id="mentor" className="h-display font-medium">
              Data Mentor
            </h2>
            <KindPill kind="bot" />
          </div>
          <p className="mt-1 text-xs text-ink-3">
            A job of the Career Mentor bot. {aiOn ? `${aiName()} drafts advice from the pipeline's numbers; rules check every number before you see it.` : "AI is off or not set up, so the rules write the advice."} It sees numbers and source names only, and it never changes a setting.
          </p>
          <div className="mt-3">
            <MentorButton focus={null} label="Review my pipeline" primary />
          </div>
          {review ? (
            <div className="mt-4">
              <p className="text-xs text-ink-3">
                {review.focus ? `About "${steps.find((x) => x.id === review.focus)?.title ?? review.focus}"` : "Whole pipeline"} · {shortDate(review.at.slice(0, 10))} · written by {review.writer === "model" ? aiName() : "the rules"}
                {review.dropped > 0 && ` · ${review.dropped} dropped by the check`}
              </p>
              {review.advice.length === 0 ? (
                <p className="mt-2 text-sm text-ink-2">Nothing to change: the pipeline meets every floor.</p>
              ) : (
                <ol className="mt-2 space-y-3">
                  {review.advice.map((a, i) => (
                    <li key={i} className="rounded-xl border border-line p-3 text-sm">
                      <p className="font-medium">
                        {i + 1}. {a.title}
                      </p>
                      <p className="mt-1 text-ink-2">{a.why}</p>
                      <p className="mt-1">
                        <span className="font-medium">Do: </span>
                        {a.action}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-3">No review yet.</p>
          )}
        </section>
      </div>


      {/* The pipeline stage by stage (moved here from Mission Control, 24 Nov 2026): what each stage keeps and sets aside. */}
      <div id="pipeline" className="scroll-mt-20">
        <PipelineView view={view} />
      </div>

      <RoleLens stats={lens} historyDays={historyDays} />

      <section className="card card-pad" aria-labelledby="sources">
        <CardHeader title="Sources" icon="plug" hint={`Turn a source off and the Scout stops reading it at the next sync. ${quality ? `Counts are from the last run, ${shortDate(quality.day)}.` : "Counts appear after the first run."}`} />
        <ul className="divide-y divide-line">
          {JOB_SOURCES.map((src) => {
            const on = !config.sourcesOff.includes(src.name);
            const q = bySource.get(src.name);
            return (
              <li key={src.name} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium">{src.name}</p>
                  <p className="text-xs text-ink-3">{src.what}</p>
                  {q && (
                    <p className="text-xs text-ink-2">
                      Last run: {q.read.toLocaleString()} read, {q.tech.toLocaleString()} tech, {q.tech ? pct(q.withPay / q.tech) : "0%"} with pay
                    </p>
                  )}
                </div>
                <SourceSwitch name={src.name} on={on} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card card-pad" aria-labelledby="controls">
        <CardHeader title="Quality floors, company cap and details" icon="settings" hint="The floors decide when Mission Control flags a figure as weak. The cap limits how much one company counts in shares and medians on the Market page." />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <FloorsForm floors={config.floors} cap={config.companyCap} />
          <DetailModeSelect mode={config.details} />
        </div>
        <p className="mt-3 text-xs text-ink-3">
          Keys: BLS {input.keys.bls ? "set" : "not set"} · FRED {input.keys.fred ? "set" : "not set"} · Adzuna {input.keys.adzuna ? "set" : "not set"}. Keys live in Vercel only.
        </p>
      </section>
    </div>
  );
}
