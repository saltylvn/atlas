import Link from "next/link";
import type { Context } from "@/lib/context";
import { prepareAnswers, type PreparedAnswer } from "@/lib/domain/careerPrep";
import { coreTitle } from "@/lib/domain/similarTitles";
import { roleSummary } from "@/lib/domain/answerDrafts";
import { ApprovalButtons, BringDraft, CopyButton } from "@/components/client/CareerActions";
import { CardHeader, Pill, timeAgo } from "@/components/ui";

const KIND: Record<string, { label: string; color: string }> = {
  application: { label: "Application", color: "var(--c-blue)" },
  "gig-proposal": { label: "Gig", color: "var(--c-teal)" },
  "follow-up": { label: "Follow-up", color: "var(--c-orange)" },
  outreach: { label: "Outreach", color: "var(--c-purple)" },
};

/** Where the Approval Queue lives: the top of Career. */
export const APPROVALS_HREF = "/career#approvals";

/**
 * Everything waiting on you, at the top of Career: jobs and gigs you gave a 👍, with
 * their apply kits, and follow-up emails to send. Nothing here is sent or submitted by
 * Atlas without your click (Semi-Automation; LinkedIn, Indeed and Glassdoor always stay so).
 */
export async function ApprovalQueue({ ctx }: { ctx: Pick<Context, "store" | "settings" | "now"> }) {
  const { store, settings, now } = ctx;
  const [approvals, resumePassages] = await Promise.all([
    store.approvals.list(),
    // Each resume's indexed passages: the first one holds its summary, offered in the matching apply kit.
    store.knowledge.bySource("resume", 200).catch(() => []),
  ]);
  const pending = approvals.filter((a) => a.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The job behind each queued application, so the answer bank can be tailored to it.
  const jobs = new Map(
    (await Promise.all(pending.filter((a) => a.matchId).map((a) => store.jobMatches.get(a.matchId!).catch(() => null)))).filter(Boolean).map((m) => [m!.id, m!]),
  );
  const recent = approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 8);

  return (
    <section id="approvals" className={`card card-pad scroll-mt-20 ${pending.length ? "card-brand" : ""}`} aria-label="Approval Queue">
      <CardHeader
        title={`Approval Queue (${pending.length})`}
        icon="check"
        hint={pending.length ? "Waiting on you. Jobs: open, apply on their site, mark submitted. Follow-ups: send from your own email." : "Semi-Automation: you submit every application yourself"}
      />
      {pending.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing waiting. Give a match below or in your brief a 👍 to queue it here; follow-ups appear when an application is quiet for a week.</p>
      ) : (
        <ul className="divide-y divide-line">
          {pending.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill color={KIND[a.kind]?.color ?? "var(--c-grey)"}>{KIND[a.kind]?.label ?? a.kind}</Pill>
                <span className="font-semibold">{a.title}</span>
                <span className="text-xs text-ink-3">queued {timeAgo(a.createdAt, now)}</span>
              </div>
              {a.kind === "follow-up" ? (
                <FollowUpDraft detail={a.detail} />
              ) : (
                <div className="mt-1 space-y-0.5 text-sm text-ink-2">
                  {a.detail.split("\n").map((line, n) => {
                    const resume = /^Resume: (https:\/\/\S+)$/.exec(line);
                    return resume ? (
                      <p key={n}>
                        <a href={resume[1]} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                          Open the resume for this role
                        </a>
                      </p>
                    ) : (
                      <p key={n}>{line}</p>
                    );
                  })}
                </div>
              )}
              {a.kind !== "follow-up" &&
                (() => {
                  const job = jobs.get(a.matchId ?? "");
                  const company = job?.company ?? a.title.split(" at ").at(-1) ?? "";
                  const type = a.kind === "gig-proposal" || job?.type === "gig" ? "gig" : "full-time";
                  return (
                    <>
                      <AnswersToPaste answers={prepareAnswers(settings.careerAnswers, { company, role: coreTitle(job?.title ?? "") }, { type, roleSummary: job ? roleSummary(resumePassages, job.role) : null })} />
                      {job && type === "full-time" && <BringDraft approvalId={a.id} company={company} />}
                    </>
                  );
                })()}
              <div className="mt-2">
                <ApprovalButtons id={a.id} url={a.url} kind={a.kind} />
              </div>
            </li>
          ))}
        </ul>
      )}

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
        Fill in your <Link href="/applications#answers" className="font-medium text-brand hover:underline">answer bank</Link> and your answers appear here, ready to paste.
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

/** A follow-up email to send from your own mail app. */
function FollowUpDraft({ detail }: { detail: string }) {
  const [first, ...rest] = detail.split("\n");
  const subject = (first ?? "").replace(/^Subject:\s*/, "");
  const body = rest.join("\n").trim();
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="mt-1 rounded-lg border border-line p-2.5 text-sm">
      <p className="font-medium">{subject}</p>
      <p className="mt-1 whitespace-pre-line text-ink-2">{body}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <CopyButton text={`${subject}\n\n${body}`} label="Copy email" />
        <a href={mailto} className="btn btn-ghost btn-sm">
          Open in mail
        </a>
      </div>
      <p className="mt-1 text-xs text-ink-3">Send it to the recruiter or hiring contact from your own email. Atlas never sends email.</p>
    </div>
  );
}
