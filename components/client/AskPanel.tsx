"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { askAtlas, indexNow, type AskReply } from "@/app/actions/ask";
import type { KnowledgeStats } from "@/lib/data/store";
import { SOURCE_LABEL } from "@/lib/domain/knowledge";
import type { Passage } from "@/lib/domain/retrieval";
import { Icon } from "../Icon";
import { Pill } from "../ui";

const GOOD = "var(--c-green)";
const WARN = "var(--c-orange)";
const GREY = "var(--c-grey)";

const EXAMPLES = ["What needs a reply from me?", "Which applications are waiting on a response?", "What bills are due soon?", "What did this morning's brief say?"];

/** Only ever link to a page inside Atlas, whatever the data says. */
const inApp = (href: string) => /^\/[A-Za-z0-9/_-]*$/.test(href);

function when(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}

function Source({ p, cited, timeZone }: { p: Passage; cited: boolean; timeZone: string }) {
  const ranks = [p.lexicalRank ? `words #${p.lexicalRank}` : "", p.semanticRank ? `meaning #${p.semanticRank}` : ""].filter(Boolean).join(" · ");
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className="tint mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ "--pc": cited ? GOOD : GREY } as React.CSSProperties}
        aria-label={cited ? `Passage ${p.n}, used in the answer` : `Passage ${p.n}`}
      >
        {p.n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="chip">{SOURCE_LABEL[p.source]}</span>
          {when(p.occurredAt, timeZone) && <span className="text-xs text-ink-3">{when(p.occurredAt, timeZone)}</span>}
          {ranks && <span className="text-xs text-ink-3">{ranks}</span>}
        </div>
        <p className="mt-1 text-sm font-medium break-words">{p.title}</p>
        <p className="mt-0.5 line-clamp-3 text-sm text-ink-2 break-words">{p.content}</p>
      </div>
      {inApp(p.href) && (
        <Link href={p.href} className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink" aria-label={`Open ${SOURCE_LABEL[p.source].toLowerCase()} page`}>
          <Icon name="arrow" size={16} />
        </Link>
      )}
    </li>
  );
}

function Reply({ r, timeZone }: { r: AskReply; timeZone: string }) {
  const cited = new Set(r.answer.citations);
  return (
    <article className="card overflow-hidden">
      <div className="card-pad">
        <p className="eyebrow">You asked</p>
        <p className="mt-0.5 font-medium break-words">{r.question}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill color={r.answer.mode === "model" ? GOOD : GREY}>{r.answer.mode === "model" ? `Written by ${r.writer} from your data` : "Closest passages, no model"}</Pill>
          <Pill color={r.search === "hybrid" ? GOOD : GREY}>{r.search === "hybrid" ? "Hybrid search" : "Keyword search"}</Pill>
          {r.narrowed && <Pill color={GREY}>Searched {r.narrowed}</Pill>}
          {!r.answer.found && <Pill color={WARN}>Not found in your data</Pill>}
          <span className="text-xs text-ink-3">{r.tookMs < 1000 ? `${Math.max(1, r.tookMs)} ms` : `${(r.tookMs / 1000).toFixed(1)} s`}</span>
        </div>
        {/* Plain text only: the answer is never rendered as HTML or turned into links. */}
        <p className="mt-3 whitespace-pre-line break-words text-[0.95rem] leading-relaxed">{r.answer.text}</p>
        {r.answer.citations.length > 0 && <p className="mt-2 text-xs text-ink-3">Based on passage{r.answer.citations.length === 1 ? "" : "s"} {r.answer.citations.join(", ")} below.</p>}
        {r.note && <p className="mt-2 text-xs text-ink-3">{r.note}</p>}
      </div>
      {r.passages.length > 0 && (
        <>
          <p className="eyebrow border-t border-line px-4 pt-3">Sources</p>
          <ul className="divide-y divide-line">
            {r.passages.map((p) => (
              <Source key={p.id} p={p} cited={cited.has(p.n)} timeZone={timeZone} />
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export function AskPanel({ stats: initial, hybrid, writer, demo, timeZone }: { stats: KnowledgeStats; hybrid: boolean; writer: string | null; demo: boolean; timeZone: string }) {
  const [question, setQuestion] = useState("");
  const [replies, setReplies] = useState<AskReply[]>([]);
  const [error, setError] = useState("");
  const [asking, startAsk] = useTransition();
  const [stats, setStats] = useState(initial);
  const [indexing, setIndexing] = useState(false);
  const [indexNote, setIndexNote] = useState("");
  const results = useRef<HTMLDivElement>(null);

  const submit = (q: string) => {
    const text = q.trim();
    if (text.length < 3 || asking) return;
    setError("");
    startAsk(async () => {
      const r = await askAtlas(text);
      if (r.ok && r.data) {
        const reply = r.data;
        setReplies((prev) => [reply, ...prev].slice(0, 5));
        setQuestion("");
        // On a phone the answer lands below the form: bring it into view.
        requestAnimationFrame(() => results.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
      } else if (!r.ok) setError(r.error);
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(question);
  };

  // A first index embeds in rounds, so no single request runs long. Stops when nothing waits.
  const runIndex = async () => {
    if (indexing) return;
    setIndexing(true);
    setIndexNote("Reading what Atlas holds…");
    try {
      for (let round = 0; round < 15; round++) {
        const r = await indexNow();
        if (!r.ok || !r.data) {
          setIndexNote(r.ok ? "" : r.error);
          return;
        }
        const o = r.data;
        setStats((s) => ({ passages: o.passages, embedded: o.passages - o.waiting, indexedAt: o.added || o.removed || o.embedded ? new Date().toISOString() : s.indexedAt }));
        if (!o.embeddings) {
          setIndexNote(demo ? `${o.passages} sample passages indexed. Demo mode searches by keyword.` : `${o.passages} passages indexed. Embeddings are not available yet, so search is by keyword.`);
          return;
        }
        if (o.waiting === 0 || o.embedded === 0) {
          setIndexNote(o.waiting === 0 ? `Up to date: ${o.passages} passages, all embedded.` : `${o.passages} passages indexed, ${o.waiting} still waiting for an embedding.`);
          return;
        }
        setIndexNote(`Embedding… ${o.passages - o.waiting} of ${o.passages}`);
      }
      setIndexNote("Still embedding. The next sync will carry on, or press Index again.");
    } finally {
      setIndexing(false);
    }
  };

  const empty = stats.passages === 0;

  return (
    <div className="space-y-5">
      <section className="card card-pad">
        <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Your question</span>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Ask about your briefs, email, people, applications…"
              className="field min-h-[48px] text-base"
            />
          </label>
          <button className="btn btn-primary min-h-[48px] sm:px-6" disabled={asking || question.trim().length < 3}>
            <Icon name="sparkle" size={16} />
            {asking ? "Searching…" : "Ask"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" onClick={() => submit(q)} disabled={asking} className="chip min-h-[36px] hover:text-ink disabled:opacity-50">
              {q}
            </button>
          ))}
        </div>
        <p className={error ? "mt-2 text-sm text-bad" : "sr-only"} role="alert">
          {error}
        </p>
      </section>

      <div ref={results} aria-live="polite" className="scroll-mt-4 space-y-5">
        {asking && (
          <div className="card card-pad">
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton mt-3 h-4 w-full rounded" />
            <div className="skeleton mt-2 h-4 w-5/6 rounded" />
          </div>
        )}
        {replies.map((r, i) => (
          <Reply key={`${replies.length - i}:${r.question}`} r={r} timeZone={timeZone} />
        ))}
      </div>

      <section className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">The index</p>
            <p className="mt-1 text-sm">
              {empty ? "Nothing is indexed yet." : `${stats.passages.toLocaleString()} passages, ${stats.embedded.toLocaleString()} with an embedding.`}
              {stats.indexedAt && <span className="text-ink-3"> Last change {when(stats.indexedAt, timeZone)}.</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill color={hybrid ? GOOD : GREY}>{hybrid ? "Hybrid: words and meaning" : demo ? "Keyword search (demo)" : "Keyword search"}</Pill>
              <Pill color={writer ? GOOD : GREY}>{writer ? `${writer} writes the answer` : "AI off: passages are shown"}</Pill>
            </div>
          </div>
          <button type="button" onClick={runIndex} disabled={indexing} className="btn btn-ghost min-h-[44px]">
            <Icon name="refresh" size={15} />
            {indexing ? "Indexing…" : empty ? "Index now" : "Index again"}
          </button>
        </div>
        <p className="mt-2 min-h-5 text-sm text-ink-2" role="status">
          {indexNote}
        </p>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ink-2 sm:grid-cols-3">
          <li>
            <span className="font-medium text-ink">Yours only.</span> Passages are built from what Atlas already stores and stay in your database. Email addresses, contact phone numbers and links are left out.
          </li>
          <li>
            <span className="font-medium text-ink">Two searches, one ranking.</span> Full-text search finds the words, embeddings find the meaning, and the two rankings are fused.
          </li>
          <li>
            <span className="font-medium text-ink">Grounded.</span> An answer may only use the passages shown, and every citation is checked against them. It changes nothing in Atlas.
          </li>
        </ul>
      </section>
    </div>
  );
}
