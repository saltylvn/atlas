"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { markBriefed } from "@/app/actions/brief";
import { runAgentNow } from "@/app/actions/agents";
import { Icon } from "../Icon";
import { Pill } from "../ui";

/**
 * One of today's briefs on Today. It arrives minimized: its headline and a green
 * "View Morning Brief" button that drops the full brief down. At the bottom of the brief
 * is its own Briefed button, so each brief is confirmed separately.
 *
 * A live preview has no Briefed button: there is nothing saved to confirm. When the brief's
 * time has passed and it still is not saved (its run failed), the panel says so and offers
 * to save it now; the saved brief then has its Briefed button.
 */
export function BriefPanel({
  slot,
  name,
  meta,
  headline,
  hot,
  briefed,
  preview,
  missed = false,
  day,
  children,
}: {
  slot: string;
  /** "Morning Brief", "Afternoon Brief" or "Saturday Brief". */
  name: string;
  /** "ready 9:00 AM" or "live preview". */
  meta: string;
  headline: string;
  /** How many items are on this brief's Hot List. */
  hot: number;
  briefed: boolean;
  /** A live preview is not saved yet, so it cannot be confirmed. */
  preview: boolean;
  /** A preview after the brief's time: its scheduled run did not save it. */
  missed?: boolean;
  /** Set when catching up on a past day's brief: confirming it counts for that day. */
  day?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(briefed);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = useId();

  return (
    <div className="space-y-5">
      <section className="card card-brand card-pad md:px-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <p className="eyebrow flex flex-wrap items-center gap-x-1.5 gap-y-1 text-brand">
              <Icon name="sparkle" size={14} /> Chief of Staff · {name}
              <span className="text-ink-3">· {meta}</span>
              {done ? (
                <Pill color="var(--c-green)">
                  <Icon name="check" size={11} /> Briefed
                </Pill>
              ) : missed ? (
                <Pill color="var(--c-warn)">Not saved</Pill>
              ) : (
                !preview && <Pill color="var(--c-indigo)">New</Pill>
              )}
              {hot > 0 && (
                <Pill color="var(--c-warn)">{hot} on the Hot List</Pill>
              )}
            </p>
            {!open && <p className="h-display mt-1.5 text-[1.05rem] font-semibold leading-snug md:text-[1.2rem]">{headline}</p>}
          </div>
          <button type="button" className="btn btn-primary w-full shrink-0 justify-center sm:w-auto" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            <Icon name="chevron" size={16} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            {open ? `Hide ${name}` : `View ${name}`}
          </button>
        </div>
      </section>

      <div id={id} hidden={!open} className="space-y-5">
        {children}
        <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            {missed
              ? `The ${name} did not save when it ran, so this is a live preview. Save it now, then mark it as briefed.`
              : preview
                ? `This is a live preview. The ${name} is saved when it runs.`
                : done
                  ? `You're briefed on the ${name}.`
                  : `That's the ${name}. Confirm you've read it.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {error && <span className="text-xs text-bad">{error}</span>}
            {missed && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setError("");
                    // The Chief of Staff's Run Now: the same run as the schedule, saved, logged.
                    const res = await runAgentNow("chief-of-staff");
                    if (res.ok) router.refresh();
                    else setError(res.error);
                  })
                }
              >
                <Icon name="refresh" size={16} className={pending ? "animate-spin" : ""} />
                {pending ? "Saving, about a minute..." : `Save the ${name}`}
              </button>
            )}
            {!preview && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={done || pending}
                onClick={() =>
                  start(async () => {
                    setError("");
                    const res = day ? await markBriefed(slot, day) : await markBriefed(slot);
                    if (res.ok) setDone(true);
                    else setError(res.error);
                  })
                }
              >
                <Icon name="check" size={16} />
                {done ? "Briefed" : pending ? "Saving..." : "Mark as briefed"}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Hide
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
