import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { MENTOR_SLOT_LABEL, type MentorInsight } from "@/lib/domain/mentor";
import { RefreshMentorButton } from "@/components/client/CareerDesk";

/**
 * The Mentor on the Today page: what it wants you to look at, and the way to Growth, where
 * the evidence and the Done / Not useful buttons are. Renders nothing when the Mentor has
 * nothing open and its last review went fine, so it only takes space when there is
 * something to act on. When the last review did not finish or fell back to rules, it says
 * so and offers Refresh and review.
 */
export function MentorCard({ insights, retry = null }: { insights: readonly MentorInsight[]; retry?: string | null }) {
  if (insights.length === 0 && !retry) return null;
  return (
    <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-purple)" }} aria-label="From your Mentor">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-[var(--c-purple)]">
          <Icon name="sparkle" size={13} /> From your Mentor
        </p>
        <Link href="/growth#mentor" className="btn btn-ghost btn-sm">
          Review in Growth <Icon name="arrow" size={14} />
        </Link>
      </div>
      {retry && (
        <div className="mb-3">
          <p className="mb-2 text-sm text-ink-2">{retry} Run it again with fresh data:</p>
          <RefreshMentorButton />
        </div>
      )}
      <ul className="space-y-3">
        {insights.map((i) => (
          <li key={i.id}>
            <Link href="/growth#mentor" className="-mx-2 block rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <span className="flex flex-wrap items-center gap-2">
                <Pill color="var(--c-purple)">{MENTOR_SLOT_LABEL[i.slot]}</Pill>
              </span>
              {/* Plain text only. */}
              <span className="h-display mt-1.5 block font-semibold break-words">{i.title}</span>
              <span className="mt-0.5 block text-sm text-ink-2 break-words">
                <span className="font-medium text-ink">Do today: </span>
                {i.action}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
