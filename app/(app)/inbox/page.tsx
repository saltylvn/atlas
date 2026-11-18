import Link from "next/link";
import { getContext } from "@/lib/context";
import { emailAgentReport, JOB_LABEL, prefsFrom, tagInbox, type TaggedItem } from "@/lib/domain/emailAgent";
import { gmailThreadUrl } from "@/lib/domain/inbox";
import type { InboxCategory } from "@/lib/domain/types";
import { ArchiveButton, DeclutterPanel, InboxDone, SyncButton } from "@/components/client/InboxActions";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill, timeAgo } from "@/components/ui";
import { APPROVALS_HREF } from "@/components/ApprovalQueue";

export const metadata = { title: "Inbox" };

const GROUPS: { key: InboxCategory; title: string; hint: string; color: string }[] = [
  { key: "reply", title: "Needs a reply", hint: "People you know, direct questions, interview invites", color: "var(--c-orange)" },
  { key: "fyi", title: "For your information", hint: "Worth a glance, no answer needed", color: "var(--c-blue)" },
  { key: "noise", title: "Noise", hint: "Newsletters, notifications, promotions", color: "var(--c-grey)" },
];

const TAG: Record<NonNullable<TaggedItem["tag"]>, { label: string; color: string }> = {
  job: { label: "Job", color: "var(--c-purple)" },
  subscription: { label: "Subscription", color: "var(--c-blue)" },
  finance: { label: "Finance", color: "var(--c-teal)" },
  store: { label: "Store", color: "var(--c-green)" },
};

function replyHref(i: TaggedItem): string {
  const subject = /^re:/i.test(i.subject) ? i.subject : `Re: ${i.subject}`;
  return `mailto:${encodeURIComponent(i.fromEmail)}?subject=${encodeURIComponent(subject)}`;
}

export default async function InboxPage() {
  const ctx = await getContext();
  const { store, now, mode, settings } = ctx;
  const [items, connections, approvals] = await Promise.all([store.inbox.list(), store.connections.list(), store.approvals.list().catch(() => [])]);
  const waiting = approvals.filter((a) => a.status === "pending").length;
  const google = connections.find((c) => c.provider === "gmail_imap") ?? connections.find((c) => c.provider === "google");
  const connected = mode === "demo" || Boolean(google);
  const canWrite = mode === "demo" || google?.provider === "gmail_imap";
  const prefs = prefsFrom(settings);
  const tagged = tagInbox(items, prefs);
  const agent = emailAgentReport({ slot: "morning", items, prefs, sync: "not_run" });
  const sum = agent.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inbox"
        sub={
          connected
            ? `${sum.needsReply} need a reply · ${sum.fyi} to skim · ${sum.noise} noise · ${agent.section.finance ?? 0} finance${google?.lastSyncAt ? ` · synced ${timeAgo(google.lastSyncAt, now)}` : mode === "demo" ? " · sample data" : ""}`
            : "Gmail, sorted into what needs you and what doesn't."
        }
        action={connected && mode === "live" ? <SyncButton /> : undefined}
      />

      {/* The Approval Queue lives in Career. Inbox only says when something waits there. */}
      {waiting > 0 && (
        <Link href={APPROVALS_HREF} className="card card-pad flex items-center gap-3 text-sm hover:bg-surface-2">
          <Icon name="check" size={18} className="text-brand" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{waiting} waiting in your Approval Queue</span>
            <span className="text-ink-2"> · it is at the top of Career</span>
          </span>
          <Icon name="arrow" size={15} className="text-ink-3" />
        </Link>
      )}

      {!connected ? (
        <section className="card card-brand card-pad">
          <CardHeader title="Connect Gmail" icon="mail" />
          <p className="text-sm text-ink-2">
            Atlas reads sender, subject and labels from the last three days and sorts each email by rules. Only for job emails, and emails from companies you applied to, does the
            Applications Agent read the text, for a rejection, an interview invite or the role; it keeps the one sentence that decided it, never the email. It never marks anything read, deletes or sends anything. The only change it makes is archiving an email when you click Archive.
          </p>
          <Link href="/connectors" className="btn btn-primary mt-4">
            <Icon name="plug" size={16} /> Set up in Connectors
          </Link>
        </section>
      ) : (
        <>
          {google?.status === "error" && <p className="banner-warn rounded-lg px-3 py-2 text-sm">{google.lastError || "The last sync failed."}</p>}

          {(agent.section.jobs?.length ?? 0) > 0 && (
            <section className="card card-pad">
              <CardHeader
                title={`Job emails (${agent.section.jobs!.length})`}
                icon="jobs"
                hint="For the Applications Agent: replies, interviews, rejections, recruiters. It reads the text of job emails and of every email from companies you applied to (not their newsletters or promotions), and only those, for a rejection, an interview invite or the role."
              />
              <ul className="space-y-2 text-sm">
                {agent.section.jobs!.map((j, n) => (
                  <li key={n}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill color={j.kind === "interview" ? "var(--c-orange)" : j.kind === "rejection" ? "var(--c-grey)" : "var(--c-purple)"}>{JOB_LABEL[j.kind]}</Pill>
                      <span className="font-medium">{j.fromName}</span>
                      <span className="min-w-0 truncate text-ink-2">{j.subject}</span>
                    </div>
                    {j.quote && (
                      <p className="mt-0.5 text-xs text-ink-3">
                        From the email: <span className="italic text-ink-2">&ldquo;{j.quote}&rdquo;</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {GROUPS.map((g) => {
            const rows = tagged.filter((i) => i.category === g.key && !i.done);
            const body =
              rows.length === 0 ? (
                <Empty>{g.key === "reply" ? "Nobody is waiting on you." : "Nothing here."}</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map((i) => (
                    <li key={i.id} className="flex items-start gap-3 py-3">
                      <InboxDone id={i.id} done={i.done} label={i.subject || "(no subject)"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="truncate text-sm font-semibold">{i.fromName}</p>
                          <span className="text-xs text-ink-3">{timeAgo(i.receivedAt, now)}</span>
                        </div>
                        <p className="truncate text-sm">{i.subject || "(no subject)"}</p>
                        {i.snippet && <p className="line-clamp-2 text-xs text-ink-3">{i.snippet}</p>}
                        {i.textQuote && i.jobKind === i.textVerdict && <p className="line-clamp-2 text-xs italic text-ink-2">&ldquo;{i.textQuote}&rdquo;</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Pill color={g.color}>{i.reason}</Pill>
                          {i.tag && (i.tag !== "job" || !i.jobKind || JOB_LABEL[i.jobKind] !== i.reason) && (
                            <Pill color={TAG[i.tag].color}>{i.tag === "job" && i.jobKind ? JOB_LABEL[i.jobKind] : (i.matched ?? TAG[i.tag].label)}</Pill>
                          )}
                          {g.key === "reply" && (
                            <a href={replyHref(i)} className="btn btn-ghost btn-sm">
                              <Icon name="mail" size={14} /> Reply
                            </a>
                          )}
                          <a href={gmailThreadUrl(i.threadId)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                            <Icon name="external" size={14} /> Gmail
                          </a>
                          {canWrite && <ArchiveButton messageId={i.messageId} label={i.subject || "(no subject)"} />}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              );
            return g.key === "noise" ? (
              <details key={g.key} className="card card-pad">
                <summary className="flex cursor-pointer list-none items-center justify-between">
                  <span className="h-display font-semibold">
                    {g.title} <span className="text-sm font-normal text-ink-3">({rows.length})</span>
                  </span>
                  <span className="text-xs text-ink-3">{g.hint}</span>
                </summary>
                <div className="mt-2">{body}</div>
              </details>
            ) : (
              <section key={g.key} className="card card-pad">
                <CardHeader title={`${g.title} (${rows.length})`} hint={g.hint} />
                {body}
              </section>
            );
          })}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card card-pad">
              <CardHeader
                title="Subscriptions"
                icon="clock"
                hint="The latest email from each one you track"
                action={
                  <Link href="/settings#email" className="btn btn-ghost btn-sm">
                    Edit
                  </Link>
                }
              />
              {prefs.subscriptions.length === 0 ? (
                <Empty>No subscriptions tracked yet. Add them in Settings.</Empty>
              ) : (
                <ul className="space-y-2 text-sm">
                  {prefs.subscriptions.map((name) => {
                    const u = agent.section.subscriptions?.find((s) => s.name === name);
                    return (
                      <li key={name}>
                        <span className="font-medium">{name}</span>
                        <span className="block truncate text-xs text-ink-3">{u ? `${u.subject || "(no subject)"} · ${timeAgo(u.receivedAt, now)}` : "No email in the inbox lately"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card card-pad">
              <CardHeader title={`Declutter (${agent.declutter.length})`} icon="x" hint="Promotional senders you don't keep. You pick; Atlas unsubscribes." />
              {agent.declutter.length === 0 ? (
                <Empty>Nothing to unsubscribe from right now.</Empty>
              ) : canWrite ? (
                <DeclutterPanel rows={agent.declutter.map((d) => ({ key: d.key, name: d.name, count: d.count, latestSubject: d.latestSubject }))} />
              ) : (
                <p className="text-sm text-ink-2">Unsubscribing needs the Gmail app-password connection.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
