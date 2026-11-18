import type { Scorecard } from "@/lib/domain/careerPrep";
import { shortDate } from "@/lib/domain/dates";

/** The week's job search at a glance: sent, replies, interviews, offers. */
export function ScorecardTiles({ s }: { s: Scorecard }) {
  const tiles: [string, number, string][] = [
    ["Sent", s.sent, "var(--c-blue)"],
    ["Replies", s.replies, "var(--c-orange)"],
    ["Interviews", s.interviews, "var(--c-purple)"],
    ["Offers", s.offers, "var(--c-green)"],
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {tiles.map(([label, n, color]) => (
          <div key={label} className="rounded-lg bg-surface-2 py-2">
            <p className="h-display text-xl font-semibold" style={{ color }}>
              {n}
            </p>
            <p className="text-[0.7rem] font-semibold text-ink-3">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-3">
        {shortDate(s.from)} – {shortDate(s.to)} · {s.rejections} rejection{s.rejections === 1 ? "" : "s"} · {s.open} open · {s.responseRate}% response rate overall
      </p>
    </div>
  );
}
