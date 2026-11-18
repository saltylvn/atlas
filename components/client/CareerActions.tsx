"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { addApplication, decideApproval, draftAnswersFromResume, draftBringForApproval, findPastApplications, rateMatch, saveAnswers, setApplicationRole, setApplicationStatus, setResumeLink, setSkills, matchFit } from "@/app/actions/career";
import type { FitResult } from "@/lib/knowledge/jobFit";
import { ANSWER_BANK, BANK_TRACK_LABEL, type BankTrack } from "@/lib/domain/careerPrep";
import { BOARD } from "@/lib/domain/applications";
import { Icon } from "../Icon";

/**
 * Thumbs on a match. Up: you want it, so its apply kit goes to your apply queue (top of
 * Career). Tap it again, or thumbs down, and a kit still waiting is taken back.
 */
export function MatchButtons({ id, rating, queued }: { id: string; rating: number; queued: boolean }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useOptimistic(rating);
  const [inQueue, setInQueue] = useState(queued);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const rate = (r: number) =>
    start(async () => {
      const next = value === r ? 0 : r;
      setValue(next);
      setNote(null);
      const res = await rateMatch(id, next);
      if (!res.ok) return setNote({ ok: false, text: res.error });
      setInQueue(res.data?.queued ?? false);
      if (res.message) setNote({ ok: true, text: res.message });
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={value === 1}
        aria-label={value === 1 ? "Wanted: in your apply queue. Tap to take it back" : "Want it: add to your apply queue"}
        title="Want it: its apply kit goes to your apply queue"
        disabled={pending}
        onClick={() => rate(1)}
        className={`btn btn-ghost btn-sm !px-2 ${value === 1 ? "!border-good !text-good" : ""}`}
      >
        👍
      </button>
      <button
        type="button"
        aria-pressed={value === -1}
        aria-label="Not a fit"
        title="Not a fit: fewer like it, and out of your apply queue"
        disabled={pending}
        onClick={() => rate(-1)}
        className={`btn btn-ghost btn-sm !px-2 ${value === -1 ? "!border-bad !text-bad" : ""}`}
      >
        👎
      </button>
      {inQueue && (
        <a href="/career#approvals" className="text-xs font-medium text-brand hover:underline">
          In your apply queue
        </a>
      )}
      {note && <span className={`text-xs ${note.ok ? "text-ink-3" : "text-bad"}`}>{note.text}</span>}
    </span>
  );
}

/** Approve, mark submitted, or reject an Approval Queue item. */
export function ApprovalButtons({ id, url, kind = "application" }: { id: string; url: string; kind?: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const decide = (d: "submitted" | "approve" | "reject") =>
    start(async () => {
      const r = await decideApproval(id, d);
      setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
    });
  if (kind === "follow-up") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide("submitted")}>
          <Icon name="check" size={14} /> I sent it
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide("reject")}>
          Skip
        </button>
        {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {url && (
        <a href={url} target="_blank" rel="noopener" className="btn btn-primary btn-sm">
          <Icon name="external" size={14} /> Open and apply
        </a>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide("submitted")}>
        <Icon name="check" size={14} /> I submitted it
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide("approve")}>
        Approve for later
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide("reject")}>
        Reject
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </div>
  );
}

/** Moves an application between board columns. */
export function StatusPicker({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useOptimistic(status);
  return (
    <select
      aria-label="Status"
      className="field !min-h-[30px] !py-0.5 text-xs"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          setValue(next);
          await setApplicationStatus(id, next);
        });
      }}
    >
      {BOARD.map((c) => (
        <option key={c.status} value={c.status}>
          {c.title}
        </option>
      ))}
    </select>
  );
}

/**
 * Fills in the role on an application the tracker logged without one. You type the title
 * as posted; "Counts as" is which of your target roles it belongs to (worked out from the
 * title unless you choose).
 */
export function ApplicationRoleForm({ id, company, roles }: { id: string; company: string; roles: string[] }) {
  const [role, setRole] = useState("");
  const [target, setTarget] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setApplicationRole(id, role, target);
          setNote(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
        });
      }}
    >
      <label className="min-w-0 flex-1 basis-56">
        <span className="sr-only">Role you applied for at {company}</span>
        <input className="field text-sm" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role you applied for" maxLength={160} required minLength={2} />
      </label>
      <label>
        <span className="sr-only">Which target role it counts as</span>
        <select className="field text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Counts as: work it out</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-ghost btn-sm min-h-[40px]" disabled={pending || role.trim().length < 2}>
        {pending ? "Saving…" : "Save"}
      </button>
      {note && (
        <span className={`text-xs ${note.ok ? "text-good" : "text-bad"}`} role="status">
          {note.text}
        </span>
      )}
    </form>
  );
}

export function FindPastApplicationsButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await findPastApplications();
            setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="mail" size={14} /> {pending ? "Searching Gmail…" : "Find past applications in Gmail"}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </span>
  );
}

export function AddApplicationForm() {
  const [state, action, pending] = useActionState(addApplication, null as ActionResult | null);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="company" required maxLength={160} placeholder="Company" className="field" />
      <input name="role" required maxLength={200} placeholder="Role" className="field" />
      <input name="url" type="url" maxLength={600} placeholder="Job link (optional)" className="field" />
      <input name="payText" maxLength={40} placeholder="Pay (optional)" className="field" />
      <select name="type" className="field" defaultValue="full-time">
        <option value="full-time">Full-time</option>
        <option value="gig">Gig / contract</option>
      </select>
      <select name="status" className="field" defaultValue="applied">
        {BOARD.map((c) => (
          <option key={c.status} value={c.status}>
            {c.title}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary btn-sm" disabled={pending}>
          <Icon name="plus" size={14} /> Add application
        </button>
        {state && <span className={`text-xs ${state.ok ? "text-good" : "text-bad"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
    </form>
  );
}

/** The resume link for one target role: paste a Google Drive (or any https) link. */
export function ResumeLinkForm({ role, url }: { role: string; url: string }) {
  const [value, setValue] = useState(url);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setResumeLink(role, value);
          setNote(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
        });
      }}
    >
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the Google Drive link"
        maxLength={600}
        aria-label={`Resume link for ${role}`}
        className="field !min-h-[34px] min-w-0 flex-1 text-sm"
      />
      <button className="btn btn-ghost btn-sm" disabled={pending || value.trim() === url}>
        Save
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
          Open
        </a>
      )}
      {note && <span className={`w-full text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </form>
  );
}

/** Copies text to the clipboard. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : label}
    </button>
  );
}

/**
 * Your answer bank: write each answer once; {company} and {role} are filled in per job.
 * "Draft from my resume" fills only the empty boxes, from your Master Resume, and marks
 * them as drafts. Nothing is saved until you press Save.
 */
export function AnswerBankForm({ saved }: { saved: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ANSWER_BANK.map((q) => [q.id, saved[q.id] ?? ""])));
  const [drafted, setDrafted] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const written = ANSWER_BANK.filter((q) => (values[q.id] ?? "").trim()).length;
  const tracks: BankTrack[] = ["contact", "common", "full-time", "gig"];
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveAnswers(values);
          if (r.ok) setDrafted(new Set());
          setNote(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-[40px]"
          disabled={drafting}
          onClick={() =>
            startDraft(async () => {
              const r = await draftAnswersFromResume();
              if (!r.ok) return setNote({ ok: false, text: r.error });
              const fill = Object.entries(r.data?.drafts ?? {}).filter(([k]) => !(values[k] ?? "").trim());
              setValues((v) => ({ ...v, ...Object.fromEntries(fill) }));
              setDrafted((d) => new Set([...d, ...fill.map(([k]) => k)]));
              setNote({ ok: true, text: fill.length ? `${fill.length} empty answer${fill.length === 1 ? "" : "s"} drafted from ${r.data?.from ?? "your resume"}. Edit them, then Save.` : "Every answer that can be drafted is already written." });
            })
          }
        >
          <Icon name="sparkle" size={14} /> {drafting ? "Reading your resume…" : "Draft from my resume"}
        </button>
        <span className="text-xs text-ink-3">
          {written} of {ANSWER_BANK.length} written. Drafts only fill empty boxes, use your resume&apos;s own words, and are not saved until you press Save.
        </span>
      </div>
      {tracks.map((track) => (
        <fieldset key={track} className="space-y-3">
          <legend className="eyebrow mb-1">{BANK_TRACK_LABEL[track]}</legend>
          {ANSWER_BANK.filter((q) => q.track === track).map((q) => (
            <label key={q.id} className="block">
              <span className="label flex flex-wrap items-center gap-2">
                {q.question.replace("{company}", "[company]")}
                {drafted.has(q.id) && <span className="pill text-[0.7rem]" style={{ color: "var(--c-purple)" }}>Draft: review before saving</span>}
              </span>
              {q.hint && <span className="mb-1 block text-xs text-ink-3">{q.hint}</span>}
              <textarea
                className="field min-h-[72px] text-sm"
                maxLength={3000}
                placeholder={q.starter || "Write your answer once; Atlas reuses it on every application."}
                value={values[q.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <p className="text-xs text-ink-3">Demographic and EEO questions (gender, race, veteran and disability status) are not here on purpose: answer them on each form yourself.</p>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={pending}>
          Save answers
        </button>
        {note && (
          <span className={`text-xs break-words ${note.ok ? "text-good" : "text-bad"}`} role="status">
            {note.text}
          </span>
        )}
      </div>
    </form>
  );
}

/** "What I'd bring" to one queued job, drafted by the AI model from your resume. Shown to copy, never saved. */
export function BringDraft({ approvalId, company }: { approvalId: string; company: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="mt-2 rounded-lg border border-dashed border-line p-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">What I&apos;d bring to {company || "this job"}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-[40px]"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await draftBringForApproval(approvalId);
              setResult(r.ok ? { ok: true, text: r.data?.text ?? "" } : { ok: false, text: r.error });
            })
          }
        >
          <Icon name="sparkle" size={14} /> {pending ? "Drafting…" : result?.ok ? "Draft again" : "Draft with AI"}
        </button>
      </div>
      {result?.ok ? (
        <>
          <p className="mt-1.5 whitespace-pre-line text-ink-2 break-words">{result.text}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <CopyButton text={result.text} />
            <span className="text-xs text-ink-3">From your resume only, checked against it. Add a line of your own on why {company || "this company"}: Atlas has not seen the posting.</span>
          </div>
        </>
      ) : result ? (
        <p className="mt-1.5 text-xs text-bad break-words" role="status">
          {result.text}
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-3">One AI call, written only from your resume passages. Nothing is saved or sent.</p>
      )}
    </div>
  );
}

/** Tick the skills you already have; the rest of what employers ask for are your gaps. */
export function SkillPicker({ groups, have }: { groups: { group: string; skills: { name: string; count: number }[] }[]; have: string[] }) {
  const [mine, setMine] = useState<Set<string>>(new Set(have));
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (n: string) =>
    setMine((s) => {
      const x = new Set(s);
      if (x.has(n)) x.delete(n);
      else x.add(n);
      return x;
    });
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.group}>
            <legend className="eyebrow mb-1.5">{g.group}</legend>
            <div className="flex flex-wrap gap-1.5">
              {g.skills.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  aria-pressed={mine.has(s.name)}
                  onClick={() => toggle(s.name)}
                  className={`btn btn-sm ${mine.has(s.name) ? "btn-primary" : "btn-ghost"}`}
                >
                  {mine.has(s.name) && <Icon name="check" size={13} />} {s.name}
                  {s.count > 0 && <span className="text-[0.7rem] opacity-70">· {s.count}</span>}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setSkills([...mine]);
              setNote(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
            })
          }
        >
          Save my skills
        </button>
        {note && <span className={`text-xs ${note.ok ? "text-good" : "text-bad"}`}>{note.text}</span>}
      </div>
    </div>
  );
}

const FIT_COLOR: Record<string, string> = { strong: "var(--c-green)", partial: "var(--c-orange)", weak: "var(--c-red)", unknown: "var(--c-grey)" };

/** "How do I fit?": searches your resumes for this job and shows the fit, the gaps and which resume to send. */
export function FitButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FitResult | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        aria-expanded={Boolean(result)}
        onClick={() =>
          result
            ? setResult(null)
            : start(async () => {
                setError("");
                const r = await matchFit(id);
                if (r.ok && r.data) setResult(r.data);
                else if (!r.ok) setError(r.error);
              })
        }
      >
        <Icon name="sparkle" size={14} /> {pending ? "Reading your resumes…" : result ? "Hide fit" : "How do I fit?"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
      {result && (
        <div className="mt-2 w-full rounded-lg border border-line bg-surface-2 p-3 text-sm" role="status">
          {result.passages.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill" style={{ "--pc": FIT_COLOR[result.fit.fit] } as React.CSSProperties}>
                {result.fit.fit === "unknown" ? "Fit not scored" : `${result.fit.fit[0]!.toUpperCase()}${result.fit.fit.slice(1)} fit`}
              </span>
              {result.fit.resume && <span className="text-xs text-ink-2">Send: {result.fit.resume} resume</span>}
              <span className="text-xs text-ink-3">{result.fit.mode === "model" ? "Judged from your resume passages" : "Skills compared by rules"}</span>
            </div>
          )}
          {/* Plain text only. */}
          {result.fit.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {result.fit.reasons.map((r) => (
                <li key={r} className="break-words">
                  {r}
                </li>
              ))}
            </ul>
          )}
          {result.fit.gaps.length > 0 && (
            <>
              <p className="eyebrow mt-2">Gaps</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                {result.fit.gaps.map((g) => (
                  <li key={g} className="break-words">
                    {g}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.passages.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-3">Resume passages used ({result.fit.citations.length} of {result.passages.length})</summary>
              <ul className="mt-1 space-y-1.5">
                {result.passages.map((p) => (
                  <li key={p.id} className={`text-xs break-words ${result.fit.citations.includes(p.n) ? "text-ink-2" : "text-ink-3"}`}>
                    <span className="font-medium">
                      [{p.n}] {p.title}
                    </span>{" "}
                    {p.content.slice(0, 260)}
                    {p.content.length > 260 ? "…" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.note && <p className="mt-2 text-xs text-ink-3">{result.note}</p>}
        </div>
      )}
    </>
  );
}
