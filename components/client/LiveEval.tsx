"use client";

import { useState, useTransition } from "react";
import { runRetrievalEval } from "@/app/actions/ask";
import type { LiveEvalReport, ModeScore } from "@/lib/domain/retrievalEval";
import { Icon } from "../Icon";

function Row({ label, s, n, strong }: { label: string; s: ModeScore; n: number; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold" : "text-ink-2"}>
      <th scope="row" className="py-1.5 pr-3 text-left font-[inherit]">
        {label}
      </th>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {s.top1}/{n}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {s.top3}/{n}
      </td>
      <td className="py-1.5 text-right tabular-nums">{s.mrr.toFixed(2)}</td>
    </tr>
  );
}

/** Runs the retrieval eval on the real embedding model and shows the three searches side by side. */
export function LiveEval({ available }: { available: boolean }) {
  const [pending, start] = useTransition();
  const [report, setReport] = useState<LiveEvalReport | null>(null);
  const [note, setNote] = useState("");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-ghost min-h-[44px]"
          disabled={pending || !available}
          onClick={() =>
            start(async () => {
              setNote("");
              const r = await runRetrievalEval();
              if (r.ok && r.data) {
                setReport(r.data.report);
                setNote(`Scored in ${(r.data.tookMs / 1000).toFixed(1)} s.`);
              } else if (!r.ok) setNote(r.error);
            })
          }
        >
          <Icon name="refresh" size={15} /> {pending ? "Embedding and scoring…" : "Run on live embeddings"}
        </button>
        <span className="text-sm text-ink-2" role="status">
          {available ? note : "Needs the live database and the embedding function. Demo mode scores keyword search only."}
        </span>
      </div>
      {report && (
        <div className="mt-3">
          <table className="w-full max-w-md text-sm">
            <thead>
              <tr className="eyebrow">
                <th scope="col" className="pb-1 text-left font-[inherit]">
                  Search
                </th>
                <th scope="col" className="pb-1 pr-3 text-right font-[inherit]">
                  First
                </th>
                <th scope="col" className="pb-1 pr-3 text-right font-[inherit]">
                  Top 3
                </th>
                <th scope="col" className="pb-1 text-right font-[inherit]">
                  MRR
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Row label="Keyword" s={report.keyword} n={report.questions} />
              <Row label="Meaning" s={report.meaning} n={report.questions} />
              <Row label="Hybrid (what Ask uses)" s={report.hybrid} n={report.questions} strong />
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-3">
            Similarity of a question to its right answer: lowest {report.similarity.answerMin.toFixed(2)}, typical {report.similarity.answerMedian.toFixed(2)}. Off-topic questions to their nearest passage: highest{" "}
            {report.similarity.offTopicMax.toFixed(2)}. {report.suggestedFloor === null ? "The two overlap, so no single floor separates them." : `A floor of ${report.suggestedFloor.toFixed(2)} separates them.`}
          </p>
          {report.misses.length > 0 && <p className="mt-1 text-xs text-ink-3">Still missed by hybrid: {report.misses.join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}
