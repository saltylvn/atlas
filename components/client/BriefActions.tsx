"use client";

import { useState, useTransition } from "react";
import { polishBrief } from "@/app/actions/brief";
import { Icon } from "../Icon";

interface Props {
  headline: string;
  summary: string[];
  aiReady: boolean;
}

/** Shows the rules-based brief, and can swap in Claude's rewrite of the same facts. */
export function BriefBody({ headline, summary, aiReady }: Props) {
  const [view, setView] = useState({ headline, summary, source: "rules" as "rules" | "ai" });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  return (
    <div>
      <h2 className="h-display text-[1.35rem] font-semibold leading-snug md:text-[1.6rem]">{view.headline}</h2>
      <ul className="mt-3 space-y-2">
        {view.summary.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-[0.95rem] leading-relaxed text-ink-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            {line}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending || !aiReady || view.source === "ai"}
          title={aiReady ? "The AI model rewrites the same facts more tightly" : "Add an AI key (Claude or Gemini) to enable"}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await polishBrief();
              if (res.ok && res.data) setView({ ...res.data, source: "ai" });
              else if (!res.ok) setError(res.error);
            })
          }
        >
          <Icon name="wand" size={16} />
          {pending ? "Working..." : view.source === "ai" ? "Polished by Claude" : "Polish with Claude"}
        </button>
        <span className="chip">{view.source === "ai" ? "Claude rewrite · facts from your data" : "Built from your data"}</span>
      </div>
    </div>
  );
}
