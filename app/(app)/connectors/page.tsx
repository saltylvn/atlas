import type { ReactNode } from "react";
import { aiConfigured, aiMissing, aiName } from "@/lib/ai/model";
import { gmailMissing, googleMissing } from "@/lib/connections/google";
import { getContext } from "@/lib/context";
import { env } from "@/lib/env";
import { FEEDS } from "@/lib/integrations/news";
import { pushConfigured, vapidPublicKey } from "@/lib/push";
import Link from "next/link";
import { DisconnectGmail, GmailAppPasswordForm, PushPanel, SyncNotionButton, TestModelButton } from "@/components/client/ConnectorsPanel";
import { Icon, type IconName } from "@/components/Icon";
import { PageHeader, Pill, timeAgo } from "@/components/ui";

export const metadata = { title: "Connectors" };

type Status = "connected" | "ready" | "setup" | "error";
const STATUS: Record<Status, { label: string; color: string }> = {
  connected: { label: "Connected", color: "var(--c-green)" },
  ready: { label: "Ready to connect", color: "var(--c-blue)" },
  setup: { label: "Needs setup", color: "var(--c-grey)" },
  error: { label: "Attention", color: "var(--c-orange)" },
};

const GOOGLE_NOTES: Record<string, string> = {
  connected: "Gmail is connected. The first sync has run.",
  declined: "Google sign-in was cancelled. Nothing was connected.",
  scope: "Gmail access was not granted. Tick the Gmail box on Google's consent screen.",
  failed: "Connecting Gmail failed. Try again.",
  not_configured: "Gmail needs server settings first (listed on the card).",
  rate_limited: "Too many attempts. Wait a few minutes.",
  demo: "Connectors are available in live mode. Demo mode uses sample data.",
};

function Card({ icon, title, status, what, children }: { icon: IconName; title: string; status: Status; what: string; children?: ReactNode }) {
  return (
    <section className="card card-pad flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="h-display flex items-center gap-2 font-semibold">
          <Icon name={icon} size={17} className="text-brand" /> {title}
        </h2>
        <Pill color={STATUS[status].color}>{STATUS[status].label}</Pill>
      </div>
      <p className="text-sm text-ink-2">{what}</p>
      {children}
    </section>
  );
}

function Missing({ names }: { names: string[] }) {
  return names.length === 0 ? null : (
    <p className="text-xs text-ink-3">
      Set in Vercel: {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ", "}
          <code className="font-mono">{n}</code>
        </span>
      ))}
    </p>
  );
}

export default async function ConnectorsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google: googleNote } = await searchParams;
  const { store, mode, now, settings } = await getContext();
  const e = env();
  const notion = settings.notion;
  const notionReady = Boolean(e.NOTION_TOKEN);
  const [connections, devices, watches] = await Promise.all([store.connections.list(), store.push.list(), store.watches.list()]);
  // An app-password connection wins over OAuth when both exist (it never expires).
  const gmail = connections.find((c) => c.provider === "gmail_imap") ?? connections.find((c) => c.provider === "google");
  const missing = gmailMissing();
  const oauthReady = googleMissing().length === 0;
  const site = e.ATLAS_SITE_URL ?? "https://<your-site>";

  return (
    <div className="space-y-5">
      <PageHeader title="Connectors" sub="Everything Atlas reads from, and how it reaches you. Read-only unless it says otherwise." />
      {googleNote && GOOGLE_NOTES[googleNote] && <p className="card px-4 py-3 text-sm">{GOOGLE_NOTES[googleNote]}</p>}

      <div className="grid gap-5 md:grid-cols-2">
        <Card
          icon="mail"
          title="Gmail"
          status={gmail ? (gmail.status === "error" ? "error" : "connected") : mode === "live" && missing.length === 0 ? "ready" : "setup"}
          what="Read-only. Sender, subject and labels from the last three days, sorted into reply, FYI and noise. Only job emails, and emails from companies you applied to (not their newsletters, promotions, bills or receipts), have their text read, by rules, for a rejection, an interview invite or the role; the one sentence that decided it is kept, never the email. Nothing is marked read, and nothing is sent."
        >
          {gmail ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{gmail.accountEmail}</span>
                <span className="text-ink-3">
                  {" "}
                  · {gmail.provider === "gmail_imap" ? "app password" : "Google sign-in"} ·{" "}
                  {gmail.lastSyncAt ? `synced ${timeAgo(gmail.lastSyncAt, now)}` : "not synced yet"}
                </span>
              </p>
              {gmail.status === "error" && <p className="text-sm text-bad">{gmail.lastError}</p>}
              {gmail.status === "error" && gmail.provider === "gmail_imap" && <GmailAppPasswordForm defaultEmail={gmail.accountEmail} />}
              <div className="flex flex-wrap gap-2">
                {gmail.status === "error" && gmail.provider === "google" && (
                  <a href="/api/connect/google" className="btn btn-primary btn-sm">
                    Reconnect
                  </a>
                )}
                <DisconnectGmail />
              </div>
            </>
          ) : mode === "demo" ? (
            <p className="text-xs text-ink-3">Demo mode shows a sample inbox. Connect your real Gmail in live mode.</p>
          ) : missing.length > 0 ? (
            <Missing names={missing} />
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
                <li>
                  Google Account → Security: turn on <b>2-Step Verification</b> if it isn&apos;t already.
                </li>
                <li>
                  Open{" "}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                    myaccount.google.com/apppasswords
                  </a>
                  , name it <b>Atlas</b>, and tap <b>Create</b>.
                </li>
                <li>Paste the 16-letter password below. Atlas checks it with Gmail, then stores it encrypted.</li>
              </ol>
              <GmailAppPasswordForm defaultEmail={e.ATLAS_OWNER_EMAIL ?? ""} />
              {oauthReady && (
                <p className="text-xs text-ink-3">
                  Or{" "}
                  <a href="/api/connect/google" className="underline">
                    use Google sign-in
                  </a>{" "}
                  (Google expires it every 7 days for apps it hasn&apos;t reviewed).
                </p>
              )}
            </>
          )}
        </Card>

        <Card
          icon="bell"
          title="Morning notification"
          status={!pushConfigured() ? "setup" : devices.length > 0 ? "connected" : "ready"}
          what="Around 6 AM, Atlas syncs your inbox, builds the brief and sends its first lines to your iPhone. Encrypted end to end to your device."
        >
          {pushConfigured() ? (
            <>
              <PushPanel publicKey={vapidPublicKey()} />
              {devices.length > 0 && <p className="text-xs text-ink-3">Devices: {devices.map((d) => d.device || "Browser").join(", ")}</p>}
              {!e.CRON_SECRET && <Missing names={["CRON_SECRET"]} />}
            </>
          ) : (
            <Missing names={["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", ...(e.CRON_SECRET ? [] : ["CRON_SECRET"])]} />
          )}
        </Card>

        <Card
          icon="message"
          title="Siri and Shortcuts capture"
          status={e.ATLAS_CAPTURE_TOKEN ? "connected" : "setup"}
          what="Say “Add to Atlas” and the thought lands in your backlog, or as an idea on Projects. Write-only: the shortcut can add, never read."
        >
          {e.ATLAS_CAPTURE_TOKEN ? (
            <details className="text-sm text-ink-2">
              <summary className="cursor-pointer font-medium text-ink">Build the shortcut (2 minutes)</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Shortcuts → New → add <b>Ask for Input</b> (Text).</li>
                <li>
                  Add <b>Get Contents of URL</b>: <code className="font-mono text-xs">{site}/api/capture</code>, method POST.
                </li>
                <li>
                  Headers: <code className="font-mono text-xs">Authorization</code> = <code className="font-mono text-xs">Bearer</code> + your ATLAS_CAPTURE_TOKEN.
                </li>
                <li>
                  Request body JSON: <code className="font-mono text-xs">text</code> = Provided Input (add <code className="font-mono text-xs">kind</code> = idea for an
                  idea shortcut).
                </li>
                <li>Name it “Add to Atlas”.</li>
              </ol>
            </details>
          ) : (
            <Missing names={["ATLAS_CAPTURE_TOKEN"]} />
          )}
        </Card>

        <Card
          icon="copy"
          title="Notion"
          status={!notionReady ? "setup" : !notion ? "ready" : notion.ok ? "connected" : "error"}
          what="Atlas reads the Resumes database in Atlas HQ: the order of your target roles and each role's resume. Reorder roles or add a resume in Notion and Atlas follows. It only sees pages you share with it. It writes two things, and only if you allow it: the resume sync's own block on each resume page, and the Priority numbers of your role rows when you approve the Mentor's proposed order (Target roles has the details)."
        >
          {notionReady ? (
            <>
              {notion ? (
                <p className="text-sm">
                  {notion.workspace && <span className="font-medium">{notion.workspace}</span>}
                  <span className="text-ink-3">
                    {notion.workspace ? " · " : ""}
                    {notion.roles} role{notion.roles === 1 ? "" : "s"}, {notion.resumes} resume{notion.resumes === 1 ? "" : "s"}{notion.master ? ` (${notion.resumes - 1} + master)` : ""} · {notion.ok ? "synced" : "last tried"} {timeAgo(notion.at, now)}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-ink-2">The token is set. Run the first sync.</p>
              )}
              {notion && !notion.ok && <p className="text-sm text-bad">{notion.message}</p>}
              {mode === "live" ? <SyncNotionButton label={notion ? "Sync now" : "Sync from Notion"} /> : <p className="text-xs text-ink-3">Demo mode uses sample data. Notion syncs in live mode.</p>}
              <p className="text-xs text-ink-3">
                Also syncs before each brief and when you open{" "}
                <Link href="/roles" className="text-brand">
                  Target roles
                </Link>
                . A resume is the row&apos;s Share link, or its attached file.
              </p>
            </>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
                <li>
                  Open{" "}
                  <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                    notion.so/profile/integrations
                  </a>{" "}
                  and create a new <b>internal</b> integration named <b>Atlas</b>. Under Capabilities keep only <b>Read content</b>.
                </li>
                <li>
                  Copy its secret into Vercel as <code className="font-mono text-xs">NOTION_TOKEN</code> (Sensitive, Production), then redeploy.
                </li>
                <li>
                  In Notion, open <b>Atlas HQ</b>, then <b>•••</b> → <b>Connections</b>, and add <b>Atlas</b>.
                </li>
                <li>Come back here and press Sync.</li>
              </ol>
              <Missing names={["NOTION_TOKEN"]} />
            </>
          )}
        </Card>

        <Card icon="plan" title="Calendar" status={e.CALENDAR_ICS_URL ? "connected" : "setup"} what="Today's meetings in the brief, from your calendar's secret iCal address. Read-only.">
          <Missing names={e.CALENDAR_ICS_URL ? [] : ["CALENDAR_ICS_URL"]} />
        </Card>

        <Card icon="sparkle" title={aiConfigured() ? `AI model: ${aiName()}` : "AI model (Claude or Gemini)"} status={aiConfigured() ? "connected" : "setup"} what="Polishes the brief, drafts messages, digests the news and writes Ask Atlas answers. One provider at a time: Claude or Google Gemini. Without a key, everything still works from rules.">
          <Missing names={aiConfigured() ? [] : [aiMissing()]} />
          {aiConfigured() && <TestModelButton />}
        </Card>

        <Card icon="news" title="News feeds" status="connected" what={`${FEEDS.length} allowlisted sources across politics, tech and AI. No account, no tracking.`} />
        <Card icon="jobs" title="Job boards" status="connected" what={`${watches.length} company boards watched on Greenhouse, Lever and Ashby. Public APIs, no account.`} />
        <Card icon="today" title="Weather" status="connected" what="Open-Meteo forecast for your city. No account, no key." />
      </div>
    </div>
  );
}
