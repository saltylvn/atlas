import { CopyButton } from "@/components/client/CareerActions";
import { PitchButton } from "@/components/client/PitchButton";
import { Pill } from "@/components/ui";
import { trajectory, type AgentState } from "@/lib/domain/agentState";
import { parsePacket } from "@/lib/domain/pitch";

// What the Tailor made for one queued job (lib/agents/pitch.ts): every must-have mapped to
// your proof or named a gap, up to three resume line swaps, and a note, plus how it got there.
// You make every change yourself, in Figma and on the job's site.

export function PitchPanel({ kitId, run }: { kitId: string; run: { status: string; state: AgentState } | null }) {
  const packet = run?.status === "done" ? parsePacket(run.state.answer) : null;
  const state = !run ? "none" : run.status === "running" ? "running" : "done";
  const tr = run ? trajectory(run.state) : null;
  const byRules = run?.state.steps.length === 0;
  return (
    <details className="mt-2 rounded-lg border border-line p-3" open={Boolean(packet)}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        Tailor: tailor this application
        {packet && <Pill color="var(--c-green)">{`${packet.map.filter((m) => m.status === "proven").length} of ${packet.map.length} proven`}</Pill>}
        {state === "running" && <Pill color="var(--c-warn)">Paused</Pill>}
      </summary>
      <p className="mt-1 text-xs text-ink-3">An AI agent: it reads the job and your resume, looks for proof of each must-have, checks every claim against your own material, and passes a review before you see it. It changes nothing; you edit in Figma.</p>
      <div className="mt-2">
        <PitchButton kitId={kitId} state={state} />
      </div>
      {packet && (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <h4 className="eyebrow mb-1">Must-haves · {packet.resume}</h4>
            {packet.map.length === 0 && <p className="text-xs text-ink-2">No must-haves found in this job yet. Open the Apply brief to read the posting, then run Pitch again.</p>}
            <ul className="space-y-1">
              {packet.map.map((m) => (
                <li key={m.requirement} className="break-words">
                  <Pill color={m.status === "proven" ? "var(--c-green)" : "var(--c-warn)"}>{m.status === "proven" ? "Proven" : "Gap"}</Pill> <span className="font-medium">{m.requirement}</span>
                  {m.evidence && <span className="block text-xs text-ink-2">{m.evidence}</span>}
                </li>
              ))}
            </ul>
          </div>
          {packet.swaps.length > 0 && (
            <div>
              <h4 className="eyebrow mb-1">Resume swaps (make them in Figma)</h4>
              <ul className="space-y-2">
                {packet.swaps.map((s) => (
                  <li key={s.from} className="break-words">
                    <span className="block text-xs text-ink-3 line-through">{s.from}</span>
                    <span className="block">{s.to}</span>
                    <span className="block text-xs text-ink-2">{s.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="eyebrow mb-1">Note to the hiring team</h4>
            <p className="whitespace-pre-wrap break-words">{packet.note}</p>
            <div className="mt-1">
              <CopyButton text={packet.note} label="Copy the note" />
            </div>
          </div>
        </div>
      )}
      {tr && (
        <p className="mt-3 text-xs text-ink-3">
          {byRules ? "Rules version: AI was not available, so proof was found by keyword and no swaps were proposed." : `How it got there: ${tr.steps} steps, ${tr.failed} failed, ${tr.recovered} recovered, ${run!.state.calls} AI calls.`}
        </p>
      )}
    </details>
  );
}
