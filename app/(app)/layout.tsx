import Link from "next/link";
import { getContext } from "@/lib/context";
import { AGENTS } from "@/lib/domain/agents";
import { AppMark } from "@/components/AppMark";
import { SideNav, TabBar } from "@/components/Nav";
import { Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { QuickCapture } from "@/components/client/QuickCapture";
import { ServiceWorker } from "@/components/client/ServiceWorker";
import { addDays } from "@/lib/domain/dates";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="overflow-hidden rounded-[9px]">
            <AppMark size={30} />
          </span>
          <span className="h-display text-lg font-semibold">Atlas</span>
        </Link>
        <SideNav />
        <div className="mt-auto rounded-lg border border-line bg-canvas p-3">
          <p className="eyebrow mb-2">Your team</p>
          <div className="flex -space-x-2">
            {AGENTS.map((a) => (
              <span key={a.id} title={`${a.name} · ${a.role}`} className="rounded-full ring-2 ring-canvas">
                <Avatar initials={a.initials} color={a.color} size={30} />
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-2">{AGENTS.length} agents. They draft; you decide.</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="pt-safe sticky top-0 z-20 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="overflow-hidden rounded-[8px]">
              <AppMark size={26} />
            </span>
            <span className="h-display font-semibold">Atlas</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/team" aria-label="Your team" className="rounded-full p-3 text-ink-2 hover:text-brand">
              <Icon name="team" size={20} />
            </Link>
            <Link href="/settings" aria-label="Settings" className="rounded-full p-3 text-ink-2 hover:text-brand">
              <Icon name="settings" size={20} />
            </Link>
          </div>
        </header>

        {ctx.mode === "demo" && (
          <div className="border-b border-line bg-brand-soft px-4 py-2 text-center text-xs font-medium text-brand md:text-sm">
            Demo mode: fictional data held in memory. Nothing is saved or sent. Connect Supabase to go live.
          </div>
        )}
        {!ctx.settings.outboundEnabled && (
          <div className="banner-warn border-b border-line px-4 py-2 text-center text-xs font-medium">
            Kill switch on: drafts cannot be handed off and AI is paused. Turn it off in Settings.
          </div>
        )}

        <main className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">{children}</main>
      </div>
      <TabBar />
      <QuickCapture today={ctx.today} tomorrow={addDays(ctx.today, 1)} />
      <ServiceWorker />
    </div>
  );
}
