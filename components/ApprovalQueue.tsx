import Link from "next/link";
import { RewriteFollowUp } from "@/components/client/RewriteFollowUp";
import type { Context } from "@/lib/context";
import { PERFECT } from "@/lib/domain/applications";
import { embedJson, EXTENSION_QUEUE_ID, EXTENSION_STATUS_ID, extensionQueue } from "@/lib/domain/autofill";
import { actionLabel, APPLY_QUEUE, perfectFirst } from "@/lib/domain/applyLane";
import { prepareAnswers, type PreparedAnswer } from "@/lib/domain/careerPrep";
import { coreTitle } from "@/lib/domain/similarTitles";
import { roleSummary } from "@/lib/domain/answerDrafts";
import { kitsToRead } from "@/lib/agents/postingReader";
import { isPostingLine } from "@/lib/domain/postingFacts";
import { firecrawlConfigured } from "@/lib/integrations/firecrawl";
import { ApprovalButtons, BringDraft, CopyButton, ReadPostingsButton } from "@/components/client/CareerActions";
import { ResumeLink } from "@/components/ResumeLink";
import { ApplyBriefCard } from "@/components/ApplyBrief";
import { QueueItem, QueueList } from "@/components/client/QueueList";
import { applyBrief, briefSince } from "@/lib/domain/applyBrief";
import { parseResearch } from "@/lib/domain/briefResearch";
import { localDate } from "@/lib/domain/dates";
import { contactForCompany } from "@/lib/domain/career";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { CardHeader, Pill, QueueFold, timeAgo } from "@/components/ui";
import { PitchPanel } from "@/components/PitchPanel";
import { FIT_LABEL, levelVerdict, maxYearsOf } from "@/lib/domain/levelPolicy";
import { pitchRunId } from "@/lib/agents/pitch";

const KIND: Record<string, { label: string; color: string }> = {
  application: { label: "Application", color: "var(--c-career)" },
  "follow-up": { label: "Follow-up", color: "var(--c-warn)" },
  outreach: { label: "Outreach", color: "var(--c-indigo)" },
};

/** Where the Apply Queue lives: on Career. */
export const APPROVALS_HREF = "/career#approvals";

/**
 * The Apply Queue, on Career: jobs you gave a 👍, with their apply kits, and follow-up emails
 * to send. You apply to every job yourself on your MacBook, with Atlas Autofill; nothing here
 * is sent or submitted by Atlas.
 */
/** Where a queued job sits against your level (lib/domain/levelPolicy.ts), with why on hover. */
function LevelPill({ title, detail, maxYears }: { title: string; detail: string; maxYears: number }) {
  const v = levelVerdict(title, detail, maxYears);
  return (
    <span title={v.why}>
      <Pill color={v.fit === "target" ? "var(--c-green)" : v.fit === "above" ? "var(--c-warn)" : "var(--c-grey)"}>{FIT_LABEL[v.fit]}</Pill>
    </span>
  );
}

export async function ApprovalQueue({ ctx }: { ctx: Pick<Context, "store" | "settings" | "now" | "mode" | "today"> }) {
  const { store, settings, now, mode, today } = ctx;
  const maxYears = maxYearsOf(settings);
  // Follow-ups the Nudger rewrote: shown with a badge.
  const written = new Set((await store.agentRunState.recent("followup", 100).catch(() => [])).filter((r) => r.status === "done").map((r) => r.runId.replace(/^followup:/, "")));
  const [approvals, resumePassages, postings, contacts] = await Promise.all([
    store.approvals.list(),
    // Each resume's indexed passages: the first one holds its summary, offered in the matching apply kit.
    store.knowledge.bySource("resume", 200).catch(() => []),
    // The Scout's postings of the last 60 days, for each job's apply brief: the market and the company's hiring.
    store.techMarket.since(briefSince(today)).catch(() => []),
    store.contacts.list().catch(() => []),
  ]);
  const waiting = approvals.filter((a) => a.status === "pending");
  // What each brief's checklist needs to know about your answers.
  const answers = {
    written: ANSWER_BANK.filter((q) => (settings.careerAnswers?.[q.id] ?? "").trim()).length,
    total: ANSWER_BANK.length,
    fixedSet: Boolean(settings.careerEligibility?.authorized && settings.careerEligibility?.sponsorship),
  };
  // Kits whose posting Atlas may read and has not read yet.
  const unread = kitsToRead(approvals).length;
  // The job behind each queued application, so the answer bank can be tailored to it.
  const jobs = new Map(
    (await Promise.all(waiting.filter((a) => a.matchId).map((a) => store.jobMatches.get(a.matchId!).catch(() => null)))).filter(Boolean).map((m) => [m!.id, m!]),
  );
  // Jobs you marked Perfect fit come first, then the longest-waiting.
  const perfect = new Set([...jobs.values()].filter((m) => m.rating === PERFECT).map((m) => m.id));
  const pending = perfectFirst(waiting, perfect);
  // What Atlas found about each job's company, for its apply brief.
  // The Tailor's latest run per job (lib/agents/pitch.ts), by run id.
  const pitchRuns = new Map((await store.agentRunState.recent("pitch", 200).catch(() => [])).map((r) => [r.runId, { status: r.status, state: r.state }]));
  const researched = await store.applyBriefs.forKits(pending.filter((a) => a.kind === "application").map((a) => a.id)).catch(() => new Map<string, { data: unknown; researchedAt: string }>());
  const recent = approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 8);

  return (
    <section id="approvals" className={`card card-pad scroll-mt-20 ${pending.length ? "card-brand" : ""}`} aria-label={APPLY_QUEUE}>
      <CardHeader
        title={`${APPLY_QUEUE} (${pending.length})`}
        icon="check"
        hint={pending.length ? "Jobs you gave a 👍, and follow-ups to send. Open each on your MacBook, apply on their site with the Safari extension, then mark it submitted." : "Jobs you 👍 land here, for your MacBook and the Safari extension."}
      />
      {unread > 0 &&
        // The demo reads a made-up posting, so the button works there without a key.
        (firecrawlConfigured() || mode === "demo" ? (
          <ReadPostingsButton count={unread} />
        ) : (
          <p className="mb-2 text-xs text-ink-3">
            Atlas can read each posting and add what it asks for (experience, skills, pay) to its kit.{" "}
            <Link href="/connectors" className="font-medium text-brand hover:underline">
              Set up Firecrawl
            </Link>{" "}
            to turn that on.
          </p>
        ))}
      {pending.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing waiting. A 👍 on a good fit lands here; follow-ups appear when an application is quiet for a week.</p>
      ) : (
        // Open however long it is, so every job's buttons (I submitted it, Not a Good Fit) show at once.
        <QueueFold count={pending.length} label={`the ${pending.length} waiting`} alert={actionLabel(pending.length)} alwaysOpen>
        <QueueList>
          {pending.map((a) => (
            <QueueItem key={a.id} id={a.id} label={a.title}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill color={KIND[a.kind]?.color ?? "var(--c-grey)"}>{KIND[a.kind]?.label ?? a.kind}</Pill>
                {a.matchId && perfect.has(a.matchId) && <Pill color="var(--brand)">★ Perfect fit</Pill>}
                {a.kind === "application" && <LevelPill title={jobs.get(a.matchId ?? "")?.title ?? a.title} detail={a.detail} maxYears={maxYears} />}
                <span className="font-semibold">{a.title}</span>
                <span className="text-xs text-ink-3">queued {timeAgo(a.createdAt, now)}</span>
              </div>
              {a.kind === "application" && a.matchId && jobs.get(a.matchId)?.role && <ResumeLink role={jobs.get(a.matchId)!.role} from="mac" />}
              {a.kind === "follow-up" ? (
                <FollowUpDraft detail={a.detail} id={a.id} written={written.has(a.id)} />
              ) : (
                <div className="mt-1 space-y-0.5 text-sm text-ink-2">
                  {a.detail.split("\n").map((line, n) => {
                    const resume = /^Resume: (https:\/\/\S+)$/.exec(line);
                    if (resume)
                      return (
                        <p key={n}>
                          <a href={resume[1]} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                            Open the resume for this role
                          </a>
                        </p>
                      );
                    // What Atlas read from the posting is set apart from the kit's own lines.
                    if (/^From the posting \(read /.test(line))
                      return (
                        <p key={n} className="eyebrow !mt-2">
                          {line.replace(/:$/, "")}
                        </p>
                      );
                    if (/^Watch for: /.test(line))
                      return (
                        <p key={n} className="font-medium text-ink">
                          {line}
                        </p>
                      );
                    return (
                      <p key={n} className={isPostingLine(line) ? "text-ink-2" : undefined}>
                        {line}
                      </p>
                    );
                  })}
                </div>
              )}
              {a.kind !== "follow-up" &&
                (() => {
                  const job = jobs.get(a.matchId ?? "");
                  const company = job?.company ?? a.title.split(" at ").at(-1) ?? "";
                  return (
                    <>
                      {job && (
                        <ApplyBriefCard
                          brief={applyBrief({ job, kitDetail: a.detail, postings, today, mySkills: settings.careerSkills ?? [], contact: contactForCompany(company, contacts)?.name ?? null, answers })}
                          approvalId={a.id}
                          research={(() => {
                            const r = researched.get(a.id);
                            const data = r ? parseResearch(r.data) : null;
                            return r && data ? { data, researchedAt: localDate(new Date(r.researchedAt), settings.timezone) } : null;
                          })()}
                        />
                      )}
                      <AnswersToPaste answers={prepareAnswers(settings.careerAnswers, { company, role: coreTitle(job?.title ?? "") }, { roleSummary: job ? roleSummary(resumePassages, job.role) : null })} />
                      {job && <BringDraft approvalId={a.id} company={company} />}
                      <PitchPanel kitId={a.id} run={pitchRuns.get(pitchRunId(a.id)) ?? null} />
                    </>
                  );
                })()}
              <div className="mt-2">
                <ApprovalButtons id={a.id} url={a.url} kind={a.kind} />
              </div>
            </QueueItem>
          ))}
        </QueueList>
        </QueueFold>
      )}

      {/* For Atlas Autofill (the Safari extension): the application kits above, as plain data. It reads this here, while you are signed in, and keeps a copy on your Mac. Never run. */}
      <script type="application/json" id={EXTENSION_QUEUE_ID} dangerouslySetInnerHTML={{ __html: embedJson(extensionQueue(pending, jobs, perfect, now)) }} />
      <p id={EXTENSION_STATUS_ID} className="mt-3 hidden text-xs text-ink-3 md:block">
        Atlas Autofill has not copied this queue in this browser yet. With the extension installed in Safari, this line changes when it does.
      </p>

      {recent.length > 0 && (
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">Recently decided ({recent.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Pill color={a.status === "approved" ? "var(--c-green)" : "var(--c-grey)"}>{a.status === "approved" ? "Approved" : "Rejected"}</Pill>
                <span>{a.title}</span>
                {a.decidedAt && <span className="text-xs text-ink-3">{timeAgo(a.decidedAt, now)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The answer bank, tailored to this job, ready to copy into the application form. */
function AnswersToPaste({ answers }: { answers: PreparedAnswer[] }) {
  if (answers.length === 0) {
    return (
      <p className="mt-2 text-xs text-ink-3">
        Fill in your <Link href="/career/setup#answers" className="font-medium text-brand hover:underline">answer bank</Link> and your answers appear here, ready to paste.
      </p>
    );
  }
  return (
    <details className="mt-2 rounded-lg border border-line p-2.5">
      <summary className="cursor-pointer text-sm font-medium">Answers ready to paste ({answers.length})</summary>
      <ul className="mt-2 space-y-2.5">
        {answers.map((x) => (
          <li key={x.id} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{x.question}</span>
              <CopyButton text={x.answer} />
            </div>
            <p className={`whitespace-pre-line text-ink-2 break-words ${x.isStarter ? "italic" : ""}`}>{x.answer}</p>
            {x.isStarter && <p className="text-xs text-ink-3">Starter text. Write your own in the answer bank.</p>}
            {x.fromResume && <p className="text-xs text-ink-3">The summary from your {x.fromResume} resume, the one that matches this job.</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A follow-up email to send from your own mail app. `written`: the Nudger wrote it (else the template). */
function FollowUpDraft({ detail, id, written }: { detail: string; id: string; written: boolean }) {
  const [first, ...rest] = detail.split("\n");
  const subject = (first ?? "").replace(/^Subject:\s*/, "");
  const body = rest.join("\n").trim();
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="mt-1 rounded-lg border border-line p-2.5 text-sm">
      {written && <p className="eyebrow mb-1">Written by the Nudger</p>}
      <p className="font-medium">{subject}</p>
      <p className="mt-1 whitespace-pre-line text-ink-2">{body}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={`${subject}\n\n${body}`} label="Copy email" />
        <a href={mailto} className="btn btn-ghost btn-sm">
          Open in mail
        </a>
        <RewriteFollowUp approvalId={id} written={written} />
      </div>
      <p className="mt-1 text-xs text-ink-3">Send it to the recruiter or hiring contact from your own email. Atlas never sends email.</p>
    </div>
  );
}
