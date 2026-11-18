"use client";

import { useState, useTransition } from "react";
import { digestNews } from "@/app/actions/brief";
import { Icon } from "../Icon";

type DigestData = { topics: { topic: string; bullets: string[] }[] };

export function DigestPanel({ aiReady }: { aiReady: boolean }) {
  const [data, setData] = useState<DigestData | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      {!data && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !aiReady}
          title={aiReady ? "" : "Add an AI key (Claude or Gemini) to enable"}
          onClick={() =>
            start(async () => {
              setError("");
              const r = await digestNews();
              if (r.ok && r.data) setData(r.data);
              else if (!r.ok) setError(r.error);
            })
          }
        >
          <Icon name="wand" size={16} /> {pending ? "Reading the news…" : "Give me the 2-minute digest"}
        </button>
      )}
      {!aiReady && <p className="mt-2 text-xs text-ink-3">The digest needs a Claude API key. Headlines below work without one.</p>}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      {data && (
        <div className="grid gap-4 md:grid-cols-3">
          {data.topics.map((t) => (
            <div key={t.topic}>
              <p className="eyebrow mb-1.5">{t.topic === "ai" ? "AI" : t.topic}</p>
              <ul className="space-y-1.5">
                {t.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
