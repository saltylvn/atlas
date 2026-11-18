import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { aiConfigured } from "@/lib/ai/model";
import { getNews, FEEDS } from "@/lib/integrations/news";
import { interleaveBySource } from "@/lib/integrations/rss";
import { NEWS_TOPICS, type NewsTopic } from "@/lib/domain/types";
import { DigestPanel } from "@/components/client/Digest";
import { CardHeader, Empty, PageHeader, timeAgo } from "@/components/ui";
import { ListSkeleton } from "@/components/Skeleton";

export const metadata = { title: "News" };

const LABEL: Record<NewsTopic, string> = { ai: "AI", tech: "Tech", politics: "Politics", world: "World" };
const COLOR: Record<NewsTopic, string> = { ai: "var(--c-purple)", tech: "var(--c-blue)", politics: "var(--c-orange)", world: "var(--c-teal)" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic: raw } = await searchParams;
  const { settings, now } = await getContext();
  const topic = NEWS_TOPICS.find((t) => t === raw) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="News" sub={`From ${[...new Set(FEEDS.filter((f) => settings.newsTopics.includes(f.topic)).map((f) => f.source))].join(", ")}`} />

      <section className="card card-pad">
        <CardHeader title="Researcher's digest" icon="sparkle" hint="Claude condenses today's headlines, grouped by topic." />
        <DigestPanel aiReady={aiConfigured() && settings.aiEnabled && settings.outboundEnabled} />
      </section>

      <nav className="flex gap-2 overflow-x-auto" aria-label="Topics">
        {[null, ...settings.newsTopics].map((t) => (
          <Link
            key={t ?? "all"}
            href={t ? `/news?topic=${t}` : "/news"}
            aria-current={topic === t ? "page" : undefined}
            className={`btn btn-sm ${topic === t ? "btn-primary" : "btn-ghost"}`}
          >
            {t ? LABEL[t] : "All"}
          </Link>
        ))}
      </nav>

      {/* The feeds stream in; the header, digest and topic filter paint first. */}
      <Suspense key={topic ?? "all"} fallback={<ListSkeleton rows={8} />}>
        <Headlines topics={settings.newsTopics} topic={topic} now={now} />
      </Suspense>
    </div>
  );
}

async function Headlines({ topics, topic, now }: { topics: NewsTopic[]; topic: NewsTopic | null; now: Date }) {
  const news = await getNews(topics);
  const items = interleaveBySource(topic ? news.items.filter((n) => n.topic === topic) : news.items);
  return (
    <>
      <section className="card overflow-hidden">
        {items.length === 0 ? (
          <div className="p-4">
            <Empty>No headlines right now.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.slice(0, 60).map((n) => (
              <li key={n.id} className="border-l-4" style={{ borderLeftColor: COLOR[n.topic] }}>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block px-4 py-3 hover:bg-surface-2">
                  <p className="font-medium group-hover:text-brand">{n.title}</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    <span className="font-semibold" style={{ color: COLOR[n.topic] }}>
                      {LABEL[n.topic]}
                    </span>{" "}
                    · {n.source}
                    {n.publishedAt ? ` · ${timeAgo(n.publishedAt, now)}` : ""}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {news.failed.length > 0 && <p className="text-xs text-ink-3">Unavailable right now: {news.failed.join(", ")}.</p>}
    </>
  );
}
