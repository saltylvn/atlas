"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { refreshMentor, runAgentNow } from "@/app/actions/agents";
import { saveJob, saveProfileText, setInsightStatus, syncResumesNow } from "@/app/actions/career";
import { decideRoleProposal, reviewRolesNow, scanGithubNow } from "@/app/actions/roles";
import { Icon } from "../Icon";

/** Done or Not useful, on one Mentor insight. A dismissed insight stays away for two weeks. */
export function InsightButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const set = (status: "done" | "dismissed") =>
    start(async () => {
      const r = await setInsightStatus(id, status);
      setError(r.ok ? "" : r.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary btn-sm min-h-[40px]" disabled={pending} onClick={() => set("done")}>
        <Icon name="check" size={14} /> Done
      </button>
      <button type="button" className="btn btn-ghost btn-sm min-h-[40px]" disabled={pending} onClick={() => set("dismissed")}>
        Not useful
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

/** Runs one Career desk agent now and says what it reported. */
export function AskAgentButton({ agent, label, busy }: { agent: "scout" | "analyst" | "mentor"; label: string; busy: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-[40px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runAgentNow(agent);
            setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Done") : r.error });
          })
        }
      >
        <Icon name="refresh" size={14} /> {pending ? busy : label}
      </button>
      {note && (
        <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`} role="status">
          {note.text}
        </span>
      )}
    </div>
  );
}

/** Your LinkedIn headline and About, pasted for the Mentor. Nothing is fetched from LinkedIn. */
export function ProfileTextForm({ text }: { text: string }) {
  const [value, setValue] = useState(text);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveProfileText(value);
          setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : r.error });
        });
      }}
    >
      <label className="block">
        <span className="label">Your headline, then your About section</span>
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={6} maxLength={12000} placeholder="AI Engineer | Agents, RAG and automation…" className="field text-base" />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-sm min-h-[40px]" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-3">Pasted by you, never read from LinkedIn. Email addresses, phone numbers and links are removed when you save.</p>
    </form>
  );
}

/** Save a job from a site with no public feed. It goes straight to the Approval Queue as an apply kit. */
export function SaveJobForm() {
  const [state, action, pending] = useActionState(saveJob, null as ActionResult | null);
  return (
    <form action={action} className="grid gap-2 sm:grid-cols-2">
      <input name="url" type="url" required maxLength={600} placeholder="Link to the posting (https://…)" className="field text-base sm:col-span-2" />
      <input name="title" required minLength={3} maxLength={200} placeholder="Job title" className="field text-base" />
      <input name="company" required maxLength={160} placeholder="Company or client" className="field text-base" />
      <select name="type" className="field text-base sm:col-span-2" defaultValue="full-time" aria-label="Track">
        <option value="full-time">Full-time role</option>
        <option value="gig">Gig or contract (Upwork and others)</option>
      </select>
      <textarea name="description" rows={4} maxLength={8000} placeholder="Paste the description. Atlas reads the skills and pay from it; the text itself is not kept." className="field text-base sm:col-span-2" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary min-h-[44px]" disabled={pending}>
          <Icon name="plus" size={15} /> {pending ? "Saving…" : "Save and build the kit"}
        </button>
        {state && (
          <span className={`text-sm ${state.ok ? "text-ink-2" : "text-bad"}`} role="status">
            {state.ok ? state.message : state.error}
          </span>
        )}
      </div>
    </form>
  );
}

/** Runs the resume sync (Figma to Notion) now and says what it did. */
export function ResumeSyncButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-[40px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncResumesNow();
            setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Done") : r.error });
          })
        }
      >
        <Icon name="refresh" size={14} /> {pending ? "Comparing with Figma…" : "Sync now"}
      </button>
      {note && (
        <span className={`text-xs break-words ${note.ok ? "text-ink-2" : "text-bad"}`} role="status">
          {note.text}
        </span>
      )}
    </div>
  );
}

/** A button that runs one server action and says what came back. */
function RunButton({ run, label, busy, icon = "refresh" }: { run: () => Promise<ActionResult>; label: string; busy: string; icon?: "refresh" | "sparkle" }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-[40px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await run();
            setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Done") : r.error });
          })
        }
      >
        <Icon name={icon} size={14} /> {pending ? busy : label}
      </button>
      {note && (
        <span className={`text-xs break-words ${note.ok ? "text-ink-2" : "text-bad"}`} role="status">
          {note.text}
        </span>
      )}
    </div>
  );
}

/** Asks the Mentor to review your role order now. */
export const ReviewRolesButton = () => <RunButton run={reviewRolesNow} label="Ask the Mentor now" busy="Reviewing your roles…" icon="sparkle" />;

/** Reads your GitHub projects now. */
export const ScanGithubButton = () => <RunButton run={scanGithubNow} label="Check GitHub now" busy="Reading GitHub…" />;

/**
 * Approve or dismiss the Mentor's proposed role order. Approve says first exactly what it
 * will write, and asks once more: it changes your Notion database.
 */
export function RoleProposalButtons({ id, writes }: { id: string; writes: string }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const decide = (decision: "approved" | "dismissed") =>
    start(async () => {
      const r = await decideRoleProposal(id, decision);
      setConfirming(false);
      setNote({ ok: r.ok, text: r.ok ? (r.message ?? "Done") : r.error });
    });
  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-sm break-words">
            <span className="font-semibold">This will write: </span>
            {writes}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm min-h-[40px]" disabled={pending} onClick={() => decide("approved")}>
              <Icon name="check" size={14} /> {pending ? "Writing…" : "Yes, approve"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm min-h-[40px]" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm min-h-[40px]" disabled={pending} onClick={() => setConfirming(true)}>
            <Icon name="check" size={14} /> Approve this order
          </button>
          <button type="button" className="btn btn-ghost btn-sm min-h-[40px]" disabled={pending} onClick={() => decide("dismissed")}>
            {pending ? "Saving…" : "Dismiss"}
          </button>
        </div>
      )}
      {note && (
        <p className={`text-xs break-words ${note.ok ? "text-good" : "text-bad"}`} role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * The Mentor's "Refresh and review": fresh postings from the Scout, your latest job emails,
 * a new market report from the Analyst, then the Mentor's review. Shows what changed; the
 * page then shows the updated insights.
 */
export function RefreshMentorButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="mb-4 space-y-2">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            setLines(null);
            const r = await refreshMentor();
            if (r.ok) {
              setLines(r.data?.lines ?? []);
              router.refresh();
            } else setError(r.error);
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Refreshing the data, then reviewing… up to a minute" : "Refresh and review"}
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
      {lines && (
        <ul className="space-y-0.5 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2" aria-live="polite">
          {lines.map((l) => (
            <li key={l} className="break-words">
              {l}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
