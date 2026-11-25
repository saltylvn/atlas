"use client";

import Link from "next/link";
import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useOptimistic, useTransition } from "react";
import { saveSettings, setSwitch } from "@/app/actions/settings";
import { SEARCH_DEFAULTS } from "@/lib/domain/searchProfile";
import { BACKGROUND_DEFAULT, MAX_YEARS_DEFAULT } from "@/lib/domain/levelPolicy";
import { NEWS_TOPICS, type Settings } from "@/lib/domain/types";

type Result = ActionResult | null;

export function SettingsForm({ s }: { s: Settings }) {
  const [state, action, pending] = useActionState(saveSettings, null as Result);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field name="displayName" label="Your name" value={s.displayName} />
      <Field name="timezone" label="Timezone" value={s.timezone} hint="e.g. America/Denver" />
      <Field name="placeName" label="Weather place" value={s.placeName} />
      <div className="grid grid-cols-2 gap-2">
        <Field name="latitude" label="Latitude" value={String(s.latitude)} type="number" step="0.0001" />
        <Field name="longitude" label="Longitude" value={String(s.longitude)} type="number" step="0.0001" />
      </div>
      <Field name="dailyCapacityMin" label="Weekday capacity (minutes of tasks)" value={String(s.dailyCapacityMin)} type="number" />
      <fieldset>
        <legend className="label">News topics</legend>
        <div className="flex gap-3 pt-2">
          {NEWS_TOPICS.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm capitalize">
              <input type="checkbox" name={`topic_${t}`} defaultChecked={s.newsTopics.includes(t)} className="h-4 w-4 accent-[var(--brand)]" />
              {t === "ai" ? "AI" : t}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <Field name="jobKeywords" label="Job title keywords (comma separated)" value={s.jobKeywords.join(", ")} />
      </div>
      <div className="sm:col-span-2">
        <Field name="jobLocations" label="Job locations (comma separated, include Remote)" value={s.jobLocations.join(", ")} />
      </div>
      <div id="career" className="sm:col-span-2">
        <p className="text-sm text-ink-2">
          Target roles and their order are set on{" "}
          <Link href="/career/roles" className="font-medium text-brand hover:underline">
            Target Roles
          </Link>
          .
        </p>
      </div>
      <Field name="careerMinSalary" label="Salary floor (USD per year, 0 for none)" value={String(s.careerMinSalary ?? SEARCH_DEFAULTS.salaryFloor)} type="number" hint="Posted pay that tops out under this is left out of your matches." />
      <Field name="careerMaxYears" label="Most years of experience a job may ask for" value={String(s.careerMaxYears ?? MAX_YEARS_DEFAULT)} type="number" hint="Jobs asking for more than this, and senior titles, are ignored by every bot and agent, and cleared from Good fits and the Apply Queue each night. Raise it as you gain experience." />
      <Field name="careerBackground" label="What you bring besides engineering" value={s.careerBackground ?? BACKGROUND_DEFAULT} hint="One sentence. The Tailor, the Researcher and the Career Mentor use it as your angle where a role values it. It is never counted as engineering years." />
      <Field name="careerTargetSalary" label="Salary target (USD per year, 0 for none)" value={String(s.careerTargetSalary ?? SEARCH_DEFAULTS.salaryTarget)} type="number" hint="What you are aiming at. A posting that reaches it ranks higher and says so." />
      <div id="email" className="sm:col-span-2">
        <Field
          name="emailSubscriptions"
          label="Subscriptions the Email bot tracks (comma separated)"
          value={(s.emailSubscriptions ?? []).join(", ")}
          hint='Use "/" for one service with two names, e.g. Disney/Hulu. Notes in parentheses are ignored.'
          optional
        />
      </div>
      <div className="sm:col-span-2">
        <Field
          name="emailStores"
          label="Stores and senders to keep (comma separated)"
          value={(s.emailStores ?? []).join(", ")}
          hint="Never proposed for unsubscribing; the Finance bot will watch their deals."
          optional
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>
          Save
        </button>
        {state && !state.ok && <span className="text-sm text-bad">{state.error}</span>}
        {state?.ok && <span className="text-sm text-good">Saved</span>}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  value,
  hint,
  type = "text",
  step,
  optional = false,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
  type?: string;
  step?: string;
  optional?: boolean;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <input name={name} defaultValue={value} type={type} step={step} required={!optional} className="field" />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Switch({ name, on, label, hint, danger }: { name: "outboundEnabled" | "aiEnabled" | "modelReader"; on: boolean; label: string; hint: string; danger?: boolean }) {
  const [, start] = useTransition();
  const [value, setValue] = useOptimistic(on);
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() =>
          start(async () => {
            setValue(!value);
            await setSwitch(name, !value);
          })
        }
        // The pseudo-element makes the tap target 44px tall without growing the switch.
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
        style={{ background: value ? (danger ? "var(--c-green)" : "var(--brand-solid)") : "var(--line-strong)" }}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
