import { AGENTS } from "@/lib/domain/agents";
import type { AgentRunEvent } from "@/lib/domain/types";
import { Avatar, CardHeader, Pill, timeAgo } from "@/components/ui";
import { AiCheckButton } from "@/components/client/AiCheckButton";

export interface AiModels {
  /** The model the agents ask first, and the quicker one Atlas falls back to when it is slow or busy. */
  writer: string;
  fast: string | null;
}

/** Why a run fell back to rules, from its trace: the step note that says so. */
function whyRules(r: AgentRunEvent): string {
  const note = (r.trace ?? []).map((s) => s.note).find((n) => /rules/i.test(n)) ?? "";
  if (/\(error\)|no answer in time/.test(note)) return "the model did not answer in time";
  if (/rate-limited/.test(note)) return "the model's free-tier rate limit was hit";
  if (/busy \(/.test(note)) return "the model was busy";
  if (/key refused/.test(note)) return "the model refused the key";
  if (/model not found/.test(note)) return "the model name was not found";
  if (/request refused|answer failed its check|declined/.test(note)) return "the model's answer could not be used";
  if (/too little time/i.test(note)) return "the run had too little time left to wait for it";
  if (/limit/i.test(note)) return "the daily AI limit was reached";
  if (/switched off|AI is off/i.test(note)) return "AI is switched off";
  if (/not in|number|cited/i.test(note)) return "its answer failed a fact check";
  return "nothing needed judging";
}

/**
 * Mission Control's view of the AI model: which agents use it, for what, and how each
 * one's last run went (judged by the model, or fell back to rules, and why).
 */
export function AiJudgmentCard({
  name,
  on,
  models,
  usedToday,
  limit,
  runs,
  lastCheck = null,
  now,
}: {
  name: string;
  on: boolean;
  models: AiModels | null;
  usedToday: number;
  limit: number;
  runs: AgentRunEvent[];
  /** The last connection check, if any. */
  lastCheck?: AgentRunEvent | null;
  now: Date;
}) {
  const users = AGENTS.filter((a) => a.ai && a.status === "live");
  const rulesOnly = AGENTS.filter((a) => !a.ai && a.status === "live");
  return (
    <section id="ai" className="card card-pad scroll-mt-20">
      <CardHeader
        title={`AI judgment: ${name}`}
        icon="sparkle"
        hint="Facts come from rules; the model judges and words them, inside checks. When it is off, slow or over its limit, each bot falls back to its rules."
        action={<Pill color={on ? "var(--c-ai)" : "var(--c-grey)"}>{on ? "Connected" : "Off"}</Pill>}
      />
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
        {models && (
          <span>
            Model: <span className="font-medium text-ink">{models.writer}</span>
            {models.fast ? (
              <>
                {" "}
                · falls back to <span className="font-medium text-ink">{models.fast}</span>
              </>
            ) : null}
          </span>
        )}
        <span>
          Today: <span className="font-medium text-ink">{usedToday}</span> of {limit} calls
        </span>
      </div>
      {models && on && (
        <div className="mb-4 rounded-lg border border-line p-3">
          <p className="mb-2 text-xs text-ink-3">
            A tiny, timed request to each model: which one answers, how fast, or why not. No personal data is sent.
            {lastCheck ? ` Last check ${timeAgo(lastCheck.at, now)}:` : ""}
          </p>
          {lastCheck && (
            <ul className="mb-2 space-y-1 text-sm">
              {(lastCheck.trace ?? []).map((s) => (
                <li key={s.name} className="flex flex-wrap items-baseline gap-x-2">
                  <span style={{ color: s.ok ? "var(--c-green)" : "var(--c-warn-ink)" }}>{s.ok ? "✓" : "✗"}</span>
                  <span className="font-medium">{s.name.replace(/^(Writer|Fast|Not in use): /, "")}</span>
                  <span className="text-xs text-ink-3">{s.name.startsWith("Writer") ? "asked first" : s.name.startsWith("Fast") ? "fallback" : "not in use"}</span>
                  <span className="text-ink-2 break-words">{s.note}</span>
                </li>
              ))}
            </ul>
          )}
          <AiCheckButton />
        </div>
      )}
      <ul className="divide-y divide-line">
        {users.map((a) => {
          const mine = runs.filter((r) => r.agent === a.id && r.status !== "started" && r.status !== "skipped");
          const last = mine[0];
          const judged = mine.find((r) => r.model);
          const fell = last && !last.model && /rules/i.test(`${last.detail} ${(last.trace ?? []).map((s) => s.note).join(" ")}`);
          return (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
              <Avatar initials={a.initials} color={a.color} size={30} />
              <div className="min-w-0 flex-1 basis-60">
                <p className="font-semibold">{a.name}</p>
                <p className="text-sm text-ink-2 break-words">{a.ai}</p>
              </div>
              <p className="text-right text-xs text-ink-3 basis-56 grow sm:grow-0">
                {!last ? (
                  "No run yet"
                ) : fell ? (
                  <span style={{ color: "var(--c-warn-ink)" }}>
                    Last run {timeAgo(last.at, now)} used rules: {whyRules(last)}
                  </span>
                ) : last.model ? (
                  <span style={{ color: "var(--c-ai-ink)" }}>
                    Judged by {name} {timeAgo(last.at, now)} ({last.model})
                  </span>
                ) : (
                  `Last run ${timeAgo(last.at, now)}: no judgment was needed`
                )}
                {judged && judged !== last ? <span className="block">Last judged by {name} {timeAgo(judged.at, now)}</span> : null}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Rules only, never a model: {rulesOnly.map((a) => a.name).join(", ")}.</p>
    </section>
  );
}
