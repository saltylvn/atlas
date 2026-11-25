import Link from "next/link";
import { composerHref, KIND_LABEL, totalMinutesOf, type DoNextItem, type DoNextKind } from "@/lib/domain/career";
import { minutesLabel } from "@/lib/domain/planner";
import { CopyDraft } from "./client/CopyDraft";
import { DoNextRow } from "./client/DoNextDone";
import { Icon } from "./Icon";
import { CardHeader, Empty, Pill } from "./ui";

const KIND_COLOR: Record<DoNextKind, string> = {
  "thank-you": "var(--c-indigo)",
  prep: "var(--c-indigo)",
  due: "var(--c-red)",
  "follow-up": "var(--c-career)",
  apply: "var(--c-green)",
  "close-out": "var(--c-grey)",
};

/** The prioritized job-search queue. Server-rendered; only the copy button is a client island. */
export function DoNextList({ items, today, pending = false }: { items: DoNextItem[]; today: string; pending?: boolean }) {
  const shown = items.slice(0, 8);
  return (
    <section className="card card-pad" aria-labelledby="do-next-title">
      <CardHeader
        title="Do next"
        icon="sparkle"
        hint={
          items.length === 0
            ? "Rules: follow up after 7 days, thank-you within 24h, prep 3 days out, close out after 30."
            : `${items.length} action${items.length === 1 ? "" : "s"} · about ${minutesLabel(totalMinutesOf(items))}${pending ? " · checking boards for new roles…" : ""}`
        }
      />
      {shown.length === 0 ? (
        <Empty>Nothing to do on the job hunt right now.</Empty>
      ) : (
        <ol className="space-y-2.5">
          {shown.map((item, idx) => (
            <DoNextRow key={item.id} id={item.id} today={today}>
              <div className="flex items-start gap-3">
                <span className="h-display mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Pill color={KIND_COLOR[item.kind]}>{KIND_LABEL[item.kind]}</Pill>
                    <span className="text-xs font-semibold text-ink-3">~{item.minutes} min</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold break-words">{item.title}</p>
                  <p className="mt-0.5 text-xs text-ink-2">{item.why}</p>

                  {item.checklist && (
                    <details className="mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand">Prep checklist ({item.checklist.length})</summary>
                      <ul className="mt-1 space-y-1.5 text-sm text-ink-2">
                        {item.checklist.map((c) => (
                          <li key={c} className="flex gap-2">
                            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-ink-3" />
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {item.draft && (
                    <details className="mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand">Draft message</summary>
                      <p className="mt-1 text-xs font-semibold text-ink-2">{item.draft.subject}</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2.5 font-sans text-sm text-ink-2">{item.draft.body}</pre>
                    </details>
                  )}

                  {(item.draft || item.contactId || item.url) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.draft && <CopyDraft itemId={item.id} company={item.company} subject={item.draft.subject} body={item.draft.body} />}
                      {item.contactId && (
                        <Link href={composerHref(item)!} className="btn btn-ghost btn-sm min-h-11">
                          <Icon name="message" size={14} /> Open in composer
                        </Link>
                      )}
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11">
                          <Icon name="external" size={14} /> {item.kind === "apply" ? "Open posting" : item.kind === "prep" ? "Meeting link" : "Posting"}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </DoNextRow>
          ))}
        </ol>
      )}
      {items.length > shown.length && <p className="mt-2 text-xs text-ink-3">+{items.length - shown.length} more lower-priority actions.</p>}
    </section>
  );
}
