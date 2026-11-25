"use client";

import { useEffect, useOptimistic, useTransition } from "react";
import { markHeardBackSeen } from "@/app/actions/career";
import { setSwitch } from "@/app/actions/settings";

/** Marks every answer in Heard back read. */
export function MarkAllReadButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost btn-sm min-h-[44px] shrink-0 sm:min-h-[32px]" disabled={pending} onClick={() => start(async () => void (await markHeardBackSeen()))}>
      Mark all read
    </button>
  );
}

/**
 * On an application's page: marks its unread answers read once the page is really open.
 * It runs in the browser, so a link that only prefetches the page marks nothing.
 */
export function SeenBeacon({ applicationId }: { applicationId: string }) {
  useEffect(() => {
    void markHeardBackSeen(applicationId);
  }, [applicationId]);
  return null;
}

/** The setting "Hold rejections for the next brief". */
export function HoldRejectionsSwitch({ on }: { on: boolean }) {
  const [, start] = useTransition();
  const [value, setValue] = useOptimistic(on);
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium">Hold rejections for the next brief</p>
        <p className="text-xs text-ink-3">On: a rejection does not ping your phone. It is unread in Heard back, and your next brief lists it. Off: it pings like any other answer.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label="Hold rejections for the next brief"
        onClick={() =>
          start(async () => {
            setValue(!value);
            await setSwitch("holdRejections", !value);
          })
        }
        // The pseudo-element makes the tap target 44px tall without growing the switch.
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
        style={{ background: value ? "var(--brand-solid)" : "var(--line-strong)" }}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
