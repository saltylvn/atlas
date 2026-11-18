import Link from "next/link";
import { AskPanel } from "@/components/client/AskPanel";
import { PageHeader } from "@/components/ui";
import { aiConfigured, aiName } from "@/lib/ai/model";
import { embeddingsConfigured } from "@/lib/ai/embeddings";
import { getContext } from "@/lib/context";
import { indexKnowledge } from "@/lib/knowledge/indexer";

export const metadata = { title: "Ask Atlas" };
export const maxDuration = 60;

/**
 * Ask Atlas: a question, answered from your own data with the sources shown.
 * Retrieval is hybrid (words and meaning); the answer is written by Claude when AI is
 * on, and is the closest passages when it is off. See docs/RAG.md.
 */
export default async function AskPage() {
  const ctx = await getContext();
  // Demo mode holds everything in memory, so its (sample) index is built on first visit.
  if (ctx.mode === "demo" && (await ctx.store.knowledge.stats()).passages === 0) {
    await indexKnowledge(ctx.store, ctx.settings.timezone, ctx.now).catch(() => null);
  }
  const stats = await ctx.store.knowledge.stats().catch(() => ({ passages: 0, embedded: 0, indexedAt: null }));
  const hybrid = ctx.mode === "live" && embeddingsConfigured();
  const writer = aiConfigured() && ctx.settings.aiEnabled && ctx.settings.outboundEnabled ? aiName() : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask Atlas"
        sub="Ask about anything Atlas holds: briefs, email, people, tasks, applications, job matches, renewals. Every answer shows the passages it came from."
        action={
          <Link href="/evals" className="btn btn-ghost btn-sm">
            Evals
          </Link>
        }
      />
      <AskPanel stats={stats} hybrid={hybrid} writer={writer} demo={ctx.mode === "demo"} timeZone={ctx.settings.timezone} />
    </div>
  );
}
