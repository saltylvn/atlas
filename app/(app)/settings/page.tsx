import Link from "next/link";
import { getContext } from "@/lib/context";
import { env } from "@/lib/env";
import { aiConfigured, aiName } from "@/lib/ai/model";
import { MODEL_READER_LABEL, modelReaderHint } from "@/lib/domain/mailReader";
import { signOut } from "@/app/actions/settings";
import { SettingsForm, Switch } from "@/components/client/SettingsForm";
import { ExtensionConnect } from "@/components/client/ExtensionConnect";
import { ClaudeConnect } from "@/components/client/ClaudeConnect";
import { headers } from "next/headers";
import { createUserClient } from "@/lib/supabase/server";
import { Icon } from "@/components/Icon";
import { CardHeader, Pill, timeAgo } from "@/components/ui";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { store, settings, mode, now } = await getContext();
  const e = env();
  const [events, aiToday] = await Promise.all([store.audit.recent(40), store.aiUsage.countToday()]);
  // Connect Claude: this deployment's address, and the apps you approved (live only).
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
  const grants =
    mode === "live"
      ? ((await (await createUserClient()).auth.oauth.listGrants().catch(() => ({ data: null }))).data ?? []).map((g) => ({ clientId: g.client.id, name: g.client.name || "An app", since: timeAgo(g.granted_at, now) }))
      : [];

  const checks: { label: string; ok: boolean; detail: string }[] = [
    { label: "Database & sign-in", ok: mode === "live", detail: mode === "live" ? "Supabase, owner-only, MFA required (aal2)" : "Demo mode: in-memory, no sign-in" },
    { label: aiConfigured() ? `AI model (${aiName()})` : "AI model", ok: aiConfigured(), detail: aiConfigured() ? `${aiToday} of ${e.ATLAS_AI_DAILY_LIMIT} calls used today` : "No API key: offline drafter and rules-based brief" },
    { label: "Calendar", ok: Boolean(e.CALENDAR_ICS_URL), detail: e.CALENDAR_ICS_URL ? "Secret iCal address set (read-only)" : "Set CALENDAR_ICS_URL" },
    { label: "Weather, news, job boards", ok: true, detail: "Public sources on a fixed allowlist, no keys" },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h-display text-[1.7rem] font-semibold md:text-[2rem]">Settings</h1>
        <form action={signOut}>
          <button className="btn btn-ghost">
            <Icon name="logout" size={16} /> Sign out everywhere
          </button>
        </form>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="card card-pad">
          <CardHeader title="Preferences" icon="settings" />
          <SettingsForm s={settings} />
        </section>

        <div className="space-y-5">
          <section className="card card-pad">
            <CardHeader title="Guardian controls" icon="shield" />
            <div className="divide-y divide-line">
              <Switch name="outboundEnabled" on={settings.outboundEnabled} danger label="Outbound allowed" hint="Off = kill switch: no drafts handed off and no AI calls. Reads keep working." />
              <Switch name="aiEnabled" on={settings.aiEnabled} label="Claude assistance" hint="Off = rules-based brief and offline drafter only." />
              <Switch name="modelReader" on={settings.modelReader === true} label={MODEL_READER_LABEL} hint={modelReaderHint(aiConfigured() ? aiName() : "the AI model")} />
            </div>
          </section>
          <section className="card card-pad">
            <CardHeader title="Integrations" icon="check" />
            <ul className="space-y-2.5">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.ok ? "var(--c-green)" : "var(--c-warn)" }} />
                  <span>
                    <span className="block text-sm font-semibold">{c.label}</span>
                    <span className="block text-xs text-ink-3">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section id="extension" className="card card-connector card-pad scroll-mt-20">
            <CardHeader title="Atlas Autofill" icon="wand" hint="The browser extension that fills job applications on your Mac. Its key can only ask Atlas to answer a form, fetch your resume, and save an answer you corrected." />
            <ExtensionConnect connected={Boolean(settings.extensionKey)} label={settings.extensionKey?.prefix ?? ""} since={settings.extensionKey ? timeAgo(settings.extensionKey.createdAt, now) : ""} used={settings.extensionKey?.lastUsedAt ? timeAgo(settings.extensionKey.lastUsedAt, now) : ""} />
          </section>
          <section id="claude" className="card card-connector card-pad scroll-mt-20">
            <CardHeader title="Connect Claude" icon="message" hint="Talk with Claude about your job search (typing or voice, on your phone or Mac): it reads Atlas through a read-only connector. Off by default. You approve each app once, signed in with your second factor; revoke it here any time." />
            <ClaudeConnect on={settings.mcpEnabled === true} url={`${origin}/api/mcp`} grants={grants} used={settings.mcpLastUsedAt ? timeAgo(settings.mcpLastUsedAt, now) : ""} />
          </section>
          <section className="card card-pad">
            <CardHeader title="Renewals" icon="clock" hint="Bills, registrations and documents, with a heads-up before they are due." />
            <Link href="/renewals" className="btn btn-ghost min-h-11">
              <Icon name="clock" size={16} /> Open renewals
            </Link>
          </section>
          <section className="card card-pad">
            <CardHeader title="Your data" icon="download" hint="Recovery: a full JSON export you can keep offline." />
            <a href="/api/export" className="btn btn-ghost" download>
              <Icon name="download" size={16} /> Export everything
            </a>
          </section>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="card-pad pb-0">
          <CardHeader title="Audit trail" icon="shield" hint="Append-only. Security-relevant events, newest first." />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-y border-line bg-surface-2 text-xs text-ink-3">
              <tr>
                <th className="px-4 py-2 font-semibold">When</th>
                <th className="px-4 py-2 font-semibold">Actor</th>
                <th className="px-4 py-2 font-semibold">Action</th>
                <th className="px-4 py-2 font-semibold">Detail</th>
                <th className="px-4 py-2 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-2">{timeAgo(ev.at, now)}</td>
                  <td className="px-4 py-2">{ev.actor}</td>
                  <td className="px-4 py-2 font-mono text-xs">{ev.action}</td>
                  <td className="max-w-[280px] truncate px-4 py-2 text-ink-2">{ev.detail}</td>
                  <td className="px-4 py-2">
                    <Pill color={ev.outcome === "success" ? "var(--c-green)" : ev.outcome === "denied" ? "var(--c-warn)" : "var(--c-red)"}>{ev.outcome}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
