"use client";

import { useState, useTransition } from "react";
import { saveEligibility, saveFormProfile } from "@/app/actions/apply";
import { PROFILE_LABEL, type FormProfile, type ProfileField } from "@/lib/domain/formProfile";
import type { Eligibility } from "@/lib/domain/types";

type Note = { ok: boolean; text: string } | null;

const QUESTIONS: { id: "authorized" | "sponsorship" | "workedHere"; label: string }[] = [
  { id: "authorized", label: "Legally authorized to work in the U.S.?" },
  { id: "sponsorship", label: "Need visa sponsorship, now or later?" },
  { id: "workedHere", label: "Worked at the company before? (your usual answer)" },
];

const PROFILE_FIELDS: { id: ProfileField; hint: string; inputMode?: "numeric" }[] = [
  { id: "phoneCode", hint: "Digits only, e.g. 1", inputMode: "numeric" },
  { id: "country", hint: "A list without it gets USA, US and the like" },
  { id: "city", hint: "Blank: your answer bank's city" },
  { id: "school", hint: "As the school writes its name" },
  { id: "degree", hint: "A list may say Bachelor's Degree" },
  { id: "discipline", hint: "Your major" },
  { id: "gradYear", hint: "Four digits", inputMode: "numeric" },
];

/** Your fixed profile answers: typed once, saved with Save, used as written on every form. */
export function ProfileAnswers({ saved }: { saved: FormProfile }) {
  const [value, setValue] = useState<FormProfile>(saved);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveFormProfile({ ...value });
      setNote(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
    });
  };
  return (
    <form onSubmit={save}>
      <fieldset className="rounded-lg border border-line p-3">
        <legend className="eyebrow px-1">Your profile on forms</legend>
        <p className="mb-2 text-xs text-ink-3">Atlas Autofill uses these as written. In a list they pick the choice that says the same thing; when none does, the question waits for you.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFILE_FIELDS.map((f) => (
            <label key={f.id} className="block">
              <span className="mb-1 block text-xs text-ink-2">{PROFILE_LABEL[f.id]}</span>
              <input
                className="field"
                value={value[f.id]}
                inputMode={f.inputMode}
                maxLength={f.id === "phoneCode" ? 5 : f.id === "gradYear" ? 4 : 120}
                onChange={(e) => setValue({ ...value, [f.id]: e.target.value })}
                aria-describedby={`profile-${f.id}-hint`}
              />
              <span id={`profile-${f.id}-hint`} className="mt-1 block text-xs text-ink-3">{f.hint}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {note && (
            <p role="status" className={`text-xs ${note.ok ? "text-ink-3" : "text-bad"}`}>
              {note.text}
            </p>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/** Your fixed answers to the eligibility questions. Saved as you pick; used exactly as saved. */
export function EligibilityAnswers({ saved }: { saved: Eligibility }) {
  const [value, setValue] = useState<Eligibility>(saved);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const pick = (id: keyof Eligibility, answer: string) => {
    const next = { ...value, [id]: answer } as Eligibility;
    setValue(next);
    start(async () => {
      const res = await saveEligibility(next);
      setNote(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
    });
  };
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="eyebrow px-1">Eligibility</legend>
      <p className="mb-2 text-xs text-ink-3">Most forms require these. Atlas uses exactly what you pick here and never drafts or guesses one. Until you pick, a form that requires it waits for you.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {QUESTIONS.map((q) => (
          <label key={q.id} className="block">
            <span className="mb-1 block text-xs text-ink-2">{q.label}</span>
            <select className="field" value={value[q.id] ?? ""} onChange={(e) => pick(q.id, e.target.value)} disabled={pending}>
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        ))}
        {/* Optional. Every other demographic question is always declined. */}
        <label className="block">
          <span className="mb-1 block text-xs text-ink-2">Gender (optional: unset, Atlas declines it)</span>
          <select className="field" value={value.gender ?? ""} onChange={(e) => pick("gender", e.target.value)} disabled={pending}>
            <option value="">Decline or leave blank</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="nonbinary">Non-binary</option>
          </select>
        </label>
      </div>
      {note && (
        <p role="status" className={`mt-2 text-xs ${note.ok ? "text-ink-3" : "text-bad"}`}>
          {note.text}
        </p>
      )}
    </fieldset>
  );
}
