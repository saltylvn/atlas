import { CopyButton } from "@/components/client/CareerActions";
import { PrepButton } from "@/components/client/PrepButton";
import { CardHeader, Pill } from "@/components/ui";
import { trajectory, type AgentState } from "@/lib/domain/agentState";
import { parsePrep, type PrepPacket } from "@/lib/domain/interviewPrep";

// What the Coach made for one application (lib/agents/interviewPrep.ts): likely
// questions with a true story each, the gaps to answer honestly, and questions to ask them.

const KIND_LABEL = { technical: "Technical", behavioral: "Behavioral", company: "Company" } as const;

/** The whole packet as plain text, to paste into notes or practise from. */
function asText(p: PrepPacket): string {
  const qs = p.questions.map((q) => `Q: ${q.question}\n${q.story ? `Situation: ${q.story.situation}\nTask: ${q.story.task}\nAction: ${q.story.action}\nResult: ${q.story.result}` : `No story yet.${q.source ? ` Look at: ${q.source}` : ""}`}`);
  return [...qs, ...(p.gaps.length ? ["Gaps:", ...p.gaps.map((g) => `- ${g.requirement}: ${g.plan}`)] : []), ...(p.ask.length ? ["Ask them:", ...p.ask.map((a) => `- ${a}`)] : [])].join("\n\n");
}

export function PrepPanel({ appId, run }: { appId: string; run: { status: string; state: AgentState } | null }) {
  const packet = run?.status === "done" ? parsePrep(run.state.answer) : null;
  const state = !run ? "none" : run.status === "running" ? "running" : "done";
  const tr = run ? trajectory(run.state) : null;
  const byRules = run?.state.steps.length === 0;
  return (
    <section id="prep" className="card card-pad scroll-mt-20" aria-labelledby="prep-title">
      <CardHeader title="Interview prep" icon="wand" hint="An AI agent: it reads the job and the company research, finds a true story for each likely question in your resumes and projects, checks every claim against your own material, and passes a review before you see it. It prepares; you practise and answer." />
      <h2 id="prep-title" className="sr-only">
        Interview prep
      </h2>
      <PrepButton appId={appId} state={state} />
      {packet && (
        <div className="mt-3 space-y-4 text-sm">
          <ol className="space-y-3">
            {packet.questions.map((q, i) => (
              <li key={`${i}-${q.question}`} className="break-words">
                <p className="flex flex-wrap items-center gap-2">
                  <Pill color={q.kind === "behavioral" ? "var(--c-indigo)" : q.kind === "company" ? "var(--c-slate)" : "var(--c-brown)"}>{KIND_LABEL[q.kind]}</Pill>
                  <span className="font-medium">{q.question}</span>
                </p>
                {q.story ? (
                  <dl className="mt-1 grid gap-0.5 text-ink-2 sm:grid-cols-[88px_minmax(0,1fr)]">
                    <dt className="text-xs text-ink-3">Situation</dt>
                    <dd>{q.story.situation}</dd>
                    <dt className="text-xs text-ink-3">Task</dt>
                    <dd>{q.story.task}</dd>
                    <dt className="text-xs text-ink-3">Action</dt>
                    <dd>{q.story.action}</dd>
                    <dt className="text-xs text-ink-3">Result</dt>
                    <dd>{q.story.result}</dd>
                  </dl>
                ) : (
                  <p className="mt-1 text-xs text-ink-3">{q.source ? `Build your answer from: ${q.source}` : "No story in your material yet: see the gaps below."}</p>
                )}
                {q.story && q.source && <p className="mt-0.5 text-xs text-ink-3">From: {q.source}</p>}
              </li>
            ))}
          </ol>
          {packet.gaps.length > 0 && (
            <div>
              <h3 className="eyebrow mb-1">Gaps to answer honestly</h3>
              <ul className="space-y-1">
                {packet.gaps.map((g) => (
                  <li key={g.requirement} className="break-words">
                    <span className="font-medium">{g.requirement}</span>
                    <span className="block text-ink-2">{g.plan}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {packet.ask.length > 0 && (
            <div>
              <h3 className="eyebrow mb-1">Ask them</h3>
              <ul className="list-disc space-y-1 pl-5">
                {packet.ask.map((a) => (
                  <li key={a} className="break-words">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <CopyButton text={asText(packet)} label="Copy the prep" />
        </div>
      )}
      {tr && <p className="mt-3 text-xs text-ink-3">{byRules ? "Rules version: AI was not available, so no stories were written; each question points to your closest proof." : `How it got there: ${tr.steps} steps, ${tr.failed} failed, ${tr.recovered} recovered, ${run!.state.calls} AI calls.`}</p>}
    </section>
  );
}
