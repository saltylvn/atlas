import Link from "next/link";
import { ApplicationRoleForm, PlaceMailButtons, StatusPicker } from "@/components/client/CareerActions";
import { Icon } from "@/components/Icon";
import { Pill, timeAgo } from "@/components/ui";
import { BOARD } from "@/lib/domain/applications";
import { localDate, shortDate } from "@/lib/domain/dates";
import { STAGE_HUE, STAGE_LABEL, stageOf } from "@/lib/domain/pipeline";
import type { CompanyGroup, NeedsYou, PipelineRow, StageGroup } from "@/lib/domain/pipelineList";
import type { Application } from "@/lib/domain/types";

// The Pipeline page's parts (docs/design-pipeline.md, 7): the Needs you lane, the list in
// its two groupings, and the six-column board kept for a wide screen. They only draw what
// lib/domain/pipelineList.ts worked out.

/**
 * Needs you: the only place on the page that asks for something. Each card has one action:
 * say which application an email is about, or name the role you applied for.
 */
export function NeedsYouLane({ items, roles, timeZone }: { items: NeedsYou[]; roles: string[]; timeZone: string }) {
  if (items.length === 0) return null;
  return (
    <section id="needs-you" className="card card-pad scroll-mt-20" aria-labelledby="needs-you-title">
      <div className="flex items-center gap-2">
        <h2 id="needs-you-title" className="eyebrow">
          Needs you
        </h2>
        <Pill color="var(--c-warn)">{items.length}</Pill>
      </div>
      <ul className="divide-y divide-line">
        {items.map((item) =>
          item.kind === "place" ? (
            <li key={item.key} className="py-3 last:pb-0">
              <p className="text-sm font-medium break-words">{item.mail.company} · which application is this?</p>
              <p className="mb-2 text-xs text-ink-3 break-words">
                {item.mail.kind} · {shortDate(localDate(new Date(item.mail.receivedAt), timeZone))} · {item.mail.subject.slice(0, 160)}
              </p>
              <p className="mb-2 text-xs text-ink-2">The email does not say which. Later emails in its thread follow your answer.</p>
              <PlaceMailButtons messageId={item.mail.messageId} company={item.mail.company} choices={item.mail.choices} />
            </li>
          ) : (
            <li key={item.key} className="py-3 last:pb-0">
              <p className="text-sm font-medium break-words">
                <Link href={`/applications/${item.app.id}`} className="hover:text-brand">
                  {item.app.company}
                </Link>{" "}
                · which role did you apply for?
              </p>
              <p className="mb-2 text-xs text-ink-3 break-words">
                {item.app.appliedOn ? `Applied ${shortDate(item.app.appliedOn)} · ` : ""}
                {STAGE_LABEL[stageOf(item.app)]}
                {item.app.notes ? ` · ${item.app.notes.slice(0, 160)}` : ""}
              </p>
              <p className="mb-2 text-xs text-ink-2">No email has named it yet. Follow-ups and the Career Mentor&apos;s results by role use it.</p>
              <ApplicationRoleForm id={item.app.id} company={item.app.company} roles={roles} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/** What the row says under the stage: how long since the company wrote. */
function heard(r: PipelineRow, now: Date): string {
  if (r.quietDays !== null) return `quiet ${r.quietDays}d`;
  if (r.lastHeardAt) return `heard ${timeAgo(r.lastHeardAt, now)}`;
  return r.stage === "saved" ? "" : "no answer yet";
}

/**
 * One application. The whole row opens its page. `under` is what the row is already listed
 * under (its stage, or its company), so the row leads with the other.
 */
function Row({ r, now, under }: { r: PipelineRow; now: Date; under: "stage" | "company" }) {
  const role = r.role || "Role not listed yet";
  const waited = heard(r, now);
  return (
    <li>
      <Link href={`/applications/${r.id}`} className="flex min-h-[44px] items-start gap-3 py-3 hover:text-brand">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 text-sm leading-snug font-medium">
            {r.unread > 0 && (
              <>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full bg-brand" />
                <span className="sr-only">Unread answer.</span>
              </>
            )}
            <span className="min-w-0 break-words">{under === "company" ? role : r.company}</span>
          </span>
          {under === "stage" && <span className="block text-xs text-ink-2 break-words">{role}</span>}
          <span className="block text-xs text-ink-3 break-words">
            {r.latest ? (
              <>
                {r.latest.title} · <time dateTime={r.latest.at}>{timeAgo(r.latest.at, now)}</time>
              </>
            ) : (
              "Nothing on its timeline yet"
            )}
            {r.reached ? ` · got as far as ${r.reached}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {under === "company" && <Pill color={STAGE_HUE[r.stage]}>{STAGE_LABEL[r.stage]}</Pill>}
          {waited && <span className="text-xs text-ink-3">{waited}</span>}
        </span>
      </Link>
    </li>
  );
}

const fold = "flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden";

/** By stage: furthest along first. What is over starts folded, unless you asked for it. */
export function StageList({ groups, now, openClosed }: { groups: StageGroup[]; now: Date; openClosed: boolean }) {
  return (
    <div className="divide-y divide-line">
      {groups.map((g) => (
        <details key={g.stage} open={!g.closed || openClosed} className="group/fold">
          <summary className={fold}>
            <Icon name="chevron" size={16} className="text-ink-3 group-open/fold:rotate-180" />
            <h3 className="flex items-center gap-2">
              <Pill color={STAGE_HUE[g.stage]}>{g.label}</Pill>
              <span className="text-xs text-ink-3">{g.rows.length}</span>
            </h3>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {g.rows.map((r) => (
              <Row key={r.id} r={r} now={now} under="stage" />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** By company: every role at a company together, so two applications there are seen as two. */
export function CompanyList({ groups, now }: { groups: CompanyGroup[]; now: Date }) {
  return (
    <ul className="divide-y divide-line">
      {groups.map((g) => (
        <li key={g.rows[0]!.id} className="py-2">
          <h3 className="pt-1 text-sm font-medium break-words">
            {g.company}
            {g.rows.length > 1 && <span className="font-normal text-ink-3"> ({g.rows.length})</span>}
          </h3>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => (
              <Row key={r.id} r={r} now={now} under="company" />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** The six-column board, for a wide screen: the one view where you move a card by hand. */
export function Board({ apps }: { apps: Application[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="grid min-w-[1100px] grid-cols-6 gap-3">
        {BOARD.map((col) => {
          const cards = apps.filter((a) => a.status === col.status).sort((a, b) => b.statusAt.localeCompare(a.statusAt));
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
                      {/* The card opens the application's own page: where it stands and its timeline. */}
                      <p className="text-sm font-semibold leading-snug">
                        <Link href={`/applications/${a.id}`} className="hover:text-brand">
                          {a.role}
                        </Link>
                      </p>
                      <p className="text-xs text-ink-2">
                        {a.company}
                        {a.url && (
                          <>
                            {" · "}
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:text-brand hover:underline">
                              posting
                            </a>
                          </>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {a.targetRole && (
                          <Pill color="var(--c-career)" className="!h-auto max-w-full whitespace-normal text-left">
                            {a.targetRole}
                          </Pill>
                        )}
                        {/* Who submitted it: you, or the Apply bot before it was removed (23 Nov 2026). */}
                        {a.status !== "saved" && <Pill color={a.tier === "auto" ? "var(--c-indigo)" : "var(--c-grey)"}>{a.tier === "auto" ? "Atlas applied" : "You applied"}</Pill>}
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
  );
}
