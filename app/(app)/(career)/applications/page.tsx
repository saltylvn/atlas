import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { BOARD, ROLE_NOT_LISTED } from "@/lib/domain/applications";
import { autofillData, embedJson } from "@/lib/domain/autofill";
import { savedSearches } from "@/lib/domain/careerAgent";
import { weeklyScorecard } from "@/lib/domain/careerPrep";
import { ScorecardTiles } from "@/components/ScorecardTiles";
import { shortDate } from "@/lib/domain/dates";
import { JOB_TYPES, type JobType } from "@/lib/domain/types";
import { AddApplicationForm, AnswerBankForm, ApplicationRoleForm, FindPastApplicationsButton, StatusPicker } from "@/components/client/CareerActions";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ type?: string; role?: string; since?: string }> }) {
  const q = await searchParams;
  const { store, settings, now, today } = await getContext();
  const apps = await store.applications.list();
  const roles = careerPrefs(settings).roles;
  // Logged from an email that did not name the role: listed first, to fill in once.
  const unnamed = apps.filter((a) => a.role === ROLE_NOT_LISTED).sort((a, b) => (b.appliedOn ?? "").localeCompare(a.appliedOn ?? ""));
  const type = JOB_TYPES.find((t) => t === q.type) ?? null;
  const role = roles.find((r) => r.name === q.role)?.name ?? null;
  const days = q.since === "7" || q.since === "30" ? Number(q.since) : null;
  const shown = apps.filter(
    (a) => (!type || a.type === type) && (!role || a.targetRole === role) && (!days || now.getTime() - Date.parse(a.statusAt) <= days * 86_400_000),
  );
  const sent = apps.filter((a) => a.status !== "saved");
  const responded = sent.filter((a) => ["replied", "interview", "offer", "rejected"].includes(a.status)).length;
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(type ? { type } : {}), ...(role ? { role } : {}), ...(days ? { since: String(days) } : {}) });
    for (const [k, v] of Object.entries(patch)) if (v === null) p.delete(k); else p.set(k, v);
    const s = p.toString();
    return s ? `/applications?${s}` : "/applications";
  };
  const chip = (label: string, to: string, on: boolean) => (
    <Link key={label} href={to} aria-current={on ? "page" : undefined} className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"}`}>
      {label}
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications"
        sub={`${sent.length} sent · ${sent.length ? Math.round((responded / sent.length) * 100) : 0}% response rate · Semi-Automation: you submit, Atlas tracks`}
        action={
          <a href="/api/applications.csv" className="btn btn-ghost btn-sm">
            <Icon name="download" size={14} /> CSV
          </a>
        }
      />

      {apps.length > 0 && (
        <section className="card card-pad">
          <CardHeader title="This week" icon="jobs" hint="The same scorecard comes in Friday's brief" />
          <ScorecardTiles s={weeklyScorecard(apps, today)} />
        </section>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Filters">
        {chip("All types", href({ type: null }), !type)}
        {chip("Full-time", href({ type: "full-time" as JobType }), type === "full-time")}
        {chip("Gigs", href({ type: "gig" as JobType }), type === "gig")}
        <span className="mx-1 w-px bg-line" />
        {chip("All roles", href({ role: null }), !role)}
        {roles.map((r) => chip(r.name, href({ role: r.name }), role === r.name))}
        <span className="mx-1 w-px bg-line" />
        {chip("Any date", href({ since: null }), !days)}
        {chip("Last 7 days", href({ since: "7" }), days === 7)}
        {chip("Last 30 days", href({ since: "30" }), days === 30)}
      </nav>

      {apps.length === 0 && (
        <section className="card card-brand card-pad">
          <CardHeader title="Start your tracker" icon="jobs" />
          <p className="text-sm text-ink-2">
            The Applications Agent logs an application whenever a company emails to thank you for applying, and moves it along as replies, interviews and rejections
            arrive. To catch up on the last 90 days, search Gmail once. A 👍 on a match in your brief adds it too, or add one below.
          </p>
          <div className="mt-3">
            <FindPastApplicationsButton />
          </div>
        </section>
      )}

      {unnamed.length > 0 && (
        <section id="roles-to-fill" className="card card-pad scroll-mt-20 border-l-4" style={{ borderLeftColor: "var(--c-orange)" }}>
          <CardHeader
            title={`Fill in the role (${unnamed.length})`}
            icon="alert"
            hint="Atlas reads the email each application was logged from, and every later email from that company, for the role. These are the ones where no email named it yet (a new one is looked up at the next sync). Type it once and the tracker, the follow-up emails and the Mentor's results by role all use it."
          />
          <ul className="divide-y divide-line">
            {unnamed.map((a) => (
              <li key={a.id} className="py-3">
                <p className="text-sm">
                  <span className="font-semibold">{a.company}</span>
                  <span className="text-ink-3">
                    {a.appliedOn ? ` · applied ${shortDate(a.appliedOn)}` : ""} · {BOARD.find((c) => c.status === a.status)?.title ?? a.status}
                  </span>
                </p>
                {a.notes && <p className="mb-2 text-xs text-ink-3 break-words">{a.notes.slice(0, 160)}</p>}
                <ApplicationRoleForm id={a.id} company={a.company} roles={roles.map((r) => r.name)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="grid min-w-[1100px] grid-cols-6 gap-3">
          {BOARD.map((col) => {
            const cards = shown.filter((a) => a.status === col.status).sort((a, b) => b.statusAt.localeCompare(a.statusAt));
            return (
              <section key={col.status} className="card card-pad !p-3">
                <p className="mb-2 flex items-center justify-between text-sm font-semibold">
                  <span style={{ color: col.color }}>{col.title}</span>
                  <span className="text-xs text-ink-3">{cards.length}</span>
                </p>
                {cards.length === 0 ? (
                  <p className="text-xs text-ink-3">None</p>
                ) : (
                  <ul className="space-y-2">
                    {cards.map((a) => (
                      <li key={a.id} className="rounded-lg border border-line p-2.5">
                        <p className="text-sm font-semibold leading-snug">
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
                              {a.role}
                            </a>
                          ) : (
                            a.role
                          )}
                        </p>
                        <p className="text-xs text-ink-2">{a.company}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <Pill color={a.type === "gig" ? "var(--c-teal)" : "var(--c-blue)"}>{a.type === "gig" ? "Gig" : "Full-time"}</Pill>
                          {a.targetRole && (
                            <Pill color="var(--c-purple)" className="!h-auto max-w-full whitespace-normal text-left">
                              {a.targetRole}
                            </Pill>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-3">
                          {a.payText || "salary not listed"}
                          {a.appliedOn ? ` · applied ${shortDate(a.appliedOn)}` : ""}
                          {a.source === "Email" ? " · from email" : ""}
                        </p>
                        <div className="mt-2">
                          <StatusPicker id={a.id} status={a.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <section id="autofill" className="card card-pad scroll-mt-20">
        <CardHeader title="Atlas Autofill for Safari" icon="wand" hint="A Safari extension that fills application forms from this answer bank when you press Fill. You review and submit; it never submits, attaches files or answers work authorization or demographic questions." />
        {/* The extension reads this on your own Applications page and keeps a copy in Safari. Plain data, never run. */}
        <script type="application/json" id="atlas-autofill-data" dangerouslySetInnerHTML={{ __html: embedJson(autofillData(settings.careerAnswers)) }} />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>Fill in the answer bank below, including your contact details, and save.</li>
          <li>Install the extension once on your Mac (it needs Xcode, which is free): the steps are in extension/safari/README.md in the Atlas repository.</li>
          <li>Open this page in Safari. The extension copies your answers from here; open it again after you change one.</li>
          <li>On an application form, click the A in Safari&apos;s toolbar, check the company and role, and press Fill this page.</li>
        </ol>
        <p id="atlas-autofill-status" className="mt-3 text-sm text-ink-3">
          Not synced in this browser yet. With the extension installed, this line changes when it copies your answers.
        </p>
      </section>

      <section id="answers" className="card card-pad scroll-mt-20">
        <CardHeader title="Answer bank" icon="copy" hint="Write each answer once. Every apply kit in the Approval Queue fills in {company} and {role} for that job, ready to paste into the application form." />
        <AnswerBankForm saved={settings.careerAnswers ?? {}} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card card-pad">
          <CardHeader title="Add an application" icon="plus" hint="One you made outside Atlas" />
          <AddApplicationForm />
          {apps.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <FindPastApplicationsButton />
            </div>
          )}
        </section>
        <section className="card card-pad">
          <CardHeader title="Saved searches" icon="external" hint="Sites with no public feed: open with your roles set" />
          <ul className="space-y-1.5 text-sm">
            {savedSearches(roles).map((s) => (
              <li key={s.site}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                  {s.site}
                </a>
                <span className="text-xs text-ink-3"> · {s.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">LinkedIn, Indeed and Glassdoor always stay Semi-Automation: their terms ban automated applying.</p>
        </section>
      </div>
      {shown.length === 0 && apps.length > 0 && <Empty>No applications match these filters.</Empty>}
    </div>
  );
}
