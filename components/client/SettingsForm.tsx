"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useOptimistic, useTransition } from "react";
import { saveSettings, setSwitch } from "@/app/actions/settings";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
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
        <Field
          name="careerRoles"
          label="Target roles for the Applications Agent, in priority order (comma separated)"
          value={(s.careerRoles?.length ? s.careerRoles : TARGET_ROLES.map((r) => r.name)).join(", ")}
          hint={`${s.notion?.ok ? "Synced from the Resumes database in Notion: change the order there (edits here are replaced at the next sync). " : ""}Each built-in role also matches its usual titles, e.g. Solutions Engineer matches Solutions Architect and Sales Engineer.`}
        />
      </div>
      <Field name="careerMinSalary" label="Full-time salary floor (USD per year, 0 for none)" value={String(s.careerMinSalary ?? 0)} type="number" />
      <Field name="careerMinRate" label="Gig rate floor (USD per hour, 0 for none)" value={String(s.careerMinRate ?? 0)} type="number" />
      <div id="email" className="sm:col-span-2">
        <Field
          name="emailSubscriptions"
          label="Subscriptions the Email Agent tracks (comma separated)"
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
          hint="Never proposed for unsubscribing; the Finance Agent will watch their deals."
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

export function Switch({ name, on, label, hint, danger }: { name: "outboundEnabled" | "aiEnabled"; on: boolean; label: string; hint: string; danger?: boolean }) {
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
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ background: value ? (danger ? "var(--c-green)" : "var(--brand-solid)") : "var(--line-strong)" }}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
