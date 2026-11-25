import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { decideConsent } from "@/app/actions/mcp";
import { AppMark } from "@/components/AppMark";
import { getContext } from "@/lib/context";
import { isAuthorizationId } from "@/lib/mcp/auth";
import { TOOLS } from "@/lib/mcp/tools";
import { createUserClient } from "@/lib/supabase/server";

export const metadata = { title: "Connect Claude" };

// Claude asks to read Atlas (Step 4). Supabase Auth sends the browser here with an
// authorization_id; the session gate has already required the owner and the second factor.
// Approve or deny; either way Supabase sends the browser back to Claude.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="card w-full max-w-md p-7">
        <span className="mb-4 block w-fit overflow-hidden rounded-xl">
          <AppMark size={44} />
        </span>
        {children}
      </div>
    </main>
  );
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  await connection();
  const { authorization_id: id } = await searchParams;
  const ctx = await getContext();
  if (ctx.mode !== "live")
    return (
      <Shell>
        <h1 className="h-display text-xl font-semibold">Connect Claude</h1>
        <p className="mt-2 text-sm text-ink-2">The demo has no accounts to connect. Connect Claude to your live Atlas.</p>
      </Shell>
    );
  if (!isAuthorizationId(id))
    return (
      <Shell>
        <h1 className="h-display text-xl font-semibold">This link is not complete</h1>
        <p className="mt-2 text-sm text-ink-2">Start again from Claude: add or reconnect the Atlas connector.</p>
      </Shell>
    );
  if (ctx.settings.mcpEnabled !== true)
    return (
      <Shell>
        <h1 className="h-display text-xl font-semibold">Claude access is off</h1>
        <p className="mt-2 text-sm text-ink-2">Turn it on in Settings, under Connect Claude, then reconnect from Claude.</p>
        <Link href="/settings#claude" className="btn btn-primary mt-4 min-h-11">
          Open Settings
        </Link>
      </Shell>
    );
  const db = await createUserClient();
  const { data, error } = await db.auth.oauth.getAuthorizationDetails(id);
  if (error || !data)
    return (
      <Shell>
        <h1 className="h-display text-xl font-semibold">This request has expired</h1>
        <p className="mt-2 text-sm text-ink-2">Requests last 10 minutes. Reconnect from Claude to start a new one.</p>
      </Shell>
    );
  // Approved before: Supabase hands back the way to Claude straight away.
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  return (
    <Shell>
      <h1 className="h-display text-xl font-semibold">Let {data.client.name || "this app"} read Atlas?</h1>
      <p className="mt-2 text-sm text-ink-2">It will read your job search through these tools. It cannot apply, send, change or delete anything: every tool is read-only, and every call is logged.</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {TOOLS.map((t) => (
          <li key={t.name}>
            <span className="font-medium">{t.title}</span>
            <span className="block text-xs text-ink-3">{t.description.replace(/^Use when [^:]*: /, "")}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 break-words text-xs text-ink-3">Sends you back to: {data.redirect_uri}</p>
      <form action={decideConsent} className="mt-5 flex flex-wrap gap-2">
        <input type="hidden" name="authorization_id" value={id} />
        <button type="submit" name="decision" value="approve" className="btn btn-primary min-h-11">
          Approve
        </button>
        <button type="submit" name="decision" value="deny" className="btn btn-ghost min-h-11">
          Deny
        </button>
      </form>
      <p className="mt-4 text-xs text-ink-3">You can turn Claude access off, or revoke this app, any time in Settings.</p>
    </Shell>
  );
}
