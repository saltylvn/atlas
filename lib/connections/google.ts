import "server-only";
import type { Store } from "@/lib/data/store";
import { triage, type MailMeta } from "@/lib/domain/inbox";
import type { InboxItem, Provider } from "@/lib/domain/types";
import { env } from "@/lib/env";
import { GMAIL_SCOPE, listInbox, refreshAccessToken, revokeToken, type GoogleClient } from "@/lib/integrations/google";
import { archiveMessages, listInboxImap, readJobMailText, searchJobMailImap, unsubscribeHeaders } from "@/lib/integrations/gmailImap";
import { ownerUserId, serviceReady } from "@/lib/owner";
import { oneClickUnsubscribe } from "@/lib/security/oneClick";
import { HttpError } from "@/lib/security/safeFetch";
import { open, parseKey, seal } from "@/lib/security/vault";
import { createServiceClient } from "@/lib/supabase/server";

// Gmail connections and the inbox sync. Two ways in, one stored row each:
//   gmail_imap  an app password (recommended: never expires, no Google review needed)
//   google      OAuth (works in Google's Testing mode, which expires every 7 days)
// Either credential is sealed with AES-256-GCM (lib/security/vault.ts) and decrypted
// only inside this module, only for the length of one sync.

/** Holds OAuth state + PKCE verifier between the connect and callback routes. */
export const OAUTH_COOKIE = "atlas_google_oauth";

const sealContext = (provider: Provider, owner: string) => `${provider}:${owner}`;

function vaultKey(): Buffer {
  const raw = env().ATLAS_VAULT_KEY;
  if (!raw) throw new Error("ATLAS_VAULT_KEY is not set");
  return parseKey(raw);
}

function owner(): string {
  const id = ownerUserId();
  if (!id || !serviceReady()) throw new Error("Owner service access is not configured");
  return id;
}

/** Settings the app-password connection needs (names only, never values). */
export function gmailMissing(): string[] {
  const e = env();
  const missing: string[] = [];
  if (!e.ATLAS_VAULT_KEY) missing.push("ATLAS_VAULT_KEY");
  if (!e.SUPABASE_SECRET_KEY) missing.push("SUPABASE_SECRET_KEY");
  if (!e.ATLAS_OWNER_USER_ID) missing.push("ATLAS_OWNER_USER_ID");
  return missing;
}

/** Settings the OAuth connection needs on top of those. */
export function googleMissing(): string[] {
  const e = env();
  const missing = gmailMissing();
  if (!e.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!e.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!e.ATLAS_SITE_URL) missing.push("ATLAS_SITE_URL");
  return missing;
}

export function googleClient(): GoogleClient {
  const e = env();
  if (googleMissing().length > 0 || !e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET || !e.ATLAS_SITE_URL) {
    throw new Error("Google is not configured");
  }
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL("/api/connect/google/callback", e.ATLAS_SITE_URL).toString(),
  };
}

export async function saveConnection(provider: Provider, input: { email: string; scopes: string; secret: string }): Promise<void> {
  const id = owner();
  const { error } = await createServiceClient()
    .from("connections")
    .upsert(
      {
        owner_id: id,
        provider,
        account_email: input.email,
        scopes: input.scopes,
        secret: seal(vaultKey(), input.secret, sealContext(provider, id)),
        status: "active",
        last_error: "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,provider" },
    );
  if (error) throw new Error(`Saving the ${provider} connection failed (${error.code ?? "error"})`);
}

export function saveGoogleConnection(input: { email: string; scopes: string; refreshToken: string }): Promise<void> {
  return saveConnection("google", { email: input.email, scopes: input.scopes, secret: input.refreshToken });
}

export function saveAppPasswordConnection(input: { email: string; appPassword: string }): Promise<void> {
  return saveConnection("gmail_imap", { email: input.email, scopes: "imap:read-only", secret: input.appPassword });
}

export async function loadConnection(provider: Provider): Promise<{ email: string; secret: string } | null> {
  const id = owner();
  const { data, error } = await createServiceClient()
    .from("connections")
    .select("secret, account_email")
    .eq("owner_id", id)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`Reading the ${provider} connection failed (${error.code ?? "error"})`);
  if (!data?.secret) return null;
  return { email: String(data.account_email), secret: open(vaultKey(), String(data.secret), sealContext(provider, id)) };
}

export async function markSync(provider: Provider, ok: boolean, message = ""): Promise<void> {
  const now = new Date().toISOString();
  await createServiceClient()
    .from("connections")
    .update(ok ? { status: "active", last_error: "", last_sync_at: now, updated_at: now } : { status: "error", last_error: message.slice(0, 300), updated_at: now })
    .eq("owner_id", owner())
    .eq("provider", provider);
}

/** Forgets every Gmail credential (revoking the OAuth token at Google) and the synced inbox. */
export async function disconnectGmail(): Promise<void> {
  const id = owner();
  const oauth = await loadConnection("google").catch(() => null);
  if (oauth) await revokeToken(oauth.secret);
  const db = createServiceClient();
  await db.from("inbox_items").delete().eq("owner_id", id);
  const { error } = await db.from("connections").delete().eq("owner_id", id).in("provider", ["google", "gmail_imap"]);
  if (error) throw new Error(`Removing the Gmail connection failed (${error.code ?? "error"})`);
}

export type SyncResult =
  /** `newestAt`: when the newest inbox email fetched arrived, or null when there was none. */
  | { status: "ok"; fetched: number; needsReply: number; newestAt: string | null }
  | { status: "not_connected" }
  | { status: "error"; message: string };

async function fetchMail(): Promise<{ provider: Provider; email: string; mails: MailMeta[] } | SyncResult> {
  const imap = await loadConnection("gmail_imap");
  if (imap) {
    try {
      return { provider: "gmail_imap", email: imap.email, mails: await listInboxImap({ user: imap.email, pass: imap.secret }) };
    } catch (err) {
      const auth = /auth|credential|password|login/i.test(String((err as { responseText?: string; message?: string }).responseText ?? (err as Error).message));
      const message = auth ? "Gmail refused the app password. It may have been revoked: create a new one and reconnect." : "Could not reach Gmail.";
      await markSync("gmail_imap", false, message);
      return { status: "error", message };
    }
  }
  const oauth = await loadConnection("google");
  if (!oauth) return { status: "not_connected" };
  let access: string;
  try {
    access = await refreshAccessToken(googleClient(), oauth.secret);
  } catch (err) {
    const message =
      err instanceof HttpError && (err.status === 400 || err.status === 401)
        ? "Google access expired or was revoked. Reconnect Gmail."
        : "Could not reach Google.";
    await markSync("google", false, message);
    return { status: "error", message };
  }
  return { provider: "google", email: oauth.email, mails: await listInbox(access) };
}

/**
 * Pulls the last three days of inbox headers, triages them, and stores the result.
 * `store` must be an owner-scoped service store (lib/owner.ts).
 */
export async function syncGmail(store: Store): Promise<SyncResult> {
  const got = await fetchMail();
  if ("status" in got) return got;
  try {
    const contacts = await store.contacts.list();
    const items = got.mails
      .filter((m) => !m.labelIds.includes("SENT") && !m.labelIds.includes("DRAFT"))
      .map((m) => {
        const t = triage(m, contacts, got.email);
        return {
          messageId: m.id,
          threadId: m.threadId,
          fromName: t.fromName,
          fromEmail: t.fromEmail,
          subject: m.subject.slice(0, 300),
          snippet: m.snippet.slice(0, 300),
          receivedAt: m.receivedAt,
          category: t.category,
          reason: t.reason.slice(0, 120),
        };
      });
    await store.inbox.upsert(items);
    await markSync(got.provider, true);
    const newestAt = items.reduce<string | null>((newest, i) => (i.receivedAt > (newest ?? "") ? i.receivedAt : newest), null);
    return { status: "ok", fetched: items.length, needsReply: items.filter((i) => i.category === "reply").length, newestAt };
  } catch {
    const message = "Gmail sync failed. It will retry on the next run.";
    await markSync(got.provider, false, message);
    return { status: "error", message };
  }
}

export function hasGmailScope(scopes: string): boolean {
  return scopes.split(" ").includes(GMAIL_SCOPE);
}

// ---------------------------------------------------------------------------
// Email Agent actions. Each runs only on the owner's explicit click, after the caller
// checked the session (assertSessionIsOwner) and passed the owner-scoped service store.

export type ArchiveResult = { status: "ok"; archived: number; missing: number } | { status: "not_connected" } | { status: "error"; message: string };

/** Archives the given emails in Gmail (removes the Inbox label), then forgets them in Atlas. */
export async function archiveInGmail(store: Store, messageIds: string[]): Promise<ArchiveResult> {
  const imap = await loadConnection("gmail_imap");
  if (!imap) return { status: "not_connected" };
  try {
    const res = await archiveMessages({ user: imap.email, pass: imap.secret }, messageIds);
    // Archived, or already gone from the Gmail inbox: either way, drop it from Atlas.
    await store.inbox.remove([...res.archived, ...res.missing]);
    return { status: "ok", archived: res.archived.length, missing: res.missing.length };
  } catch {
    return { status: "error", message: "Could not reach Gmail to archive. Nothing was changed." };
  }
}

export type UnsubscribeOutcome =
  | { status: "unsubscribed" }
  | { status: "link"; url: string }
  | { status: "mailto"; url: string }
  | { status: "none" }
  | { status: "not_connected" }
  | { status: "error"; message: string };

/**
 * Unsubscribes from a sender domain the owner approved. Reads the newest email's
 * List-Unsubscribe headers; when the sender supports one-click unsubscribe (RFC 8058),
 * Atlas sends it. Otherwise the owner gets the sender's link to finish it themselves.
 */
export async function unsubscribeSender(domain: string): Promise<UnsubscribeOutcome> {
  const imap = await loadConnection("gmail_imap");
  if (!imap) return { status: "not_connected" };
  let headers;
  try {
    headers = await unsubscribeHeaders({ user: imap.email, pass: imap.secret }, domain);
  } catch {
    return { status: "error", message: "Could not reach Gmail." };
  }
  if (!headers || (!headers.https && !headers.mailto)) return { status: "none" };
  if (headers.oneClick) {
    try {
      if (await oneClickUnsubscribe(headers.https)) return { status: "unsubscribed" };
    } catch {
      // Refused (unsafe target) or failed: fall back to the link, which the owner opens.
    }
  }
  if (headers.https) return { status: "link", url: headers.https };
  return { status: "mailto", url: headers.mailto };
}

/** How long the Applications Agent waits for Gmail to hand over job emails' text. */
const READ_TEXT_WAIT_MS = 15_000;

/**
 * The text of these job emails (Gmail ids), read-only, for the Applications Agent to read
 * a verdict from. Over the app-password connection only (the OAuth one is not used for
 * this). Null when Gmail is not connected that way, is slow, or fails: nothing is marked
 * read either way. The text is not stored or logged here.
 */
export async function readJobMailTexts(messageIds: string[]): Promise<Map<string, string> | null> {
  if (messageIds.length === 0) return new Map();
  const imap = await loadConnection("gmail_imap");
  if (!imap) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READ_TEXT_WAIT_MS);
  });
  try {
    return await Promise.race([readJobMailText({ user: imap.email, pass: imap.secret }, messageIds).catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

export type JobMailResult = { status: "ok"; items: InboxItem[] } | { status: "not_connected" } | { status: "error"; message: string };

/**
 * Past application emails from Gmail (read-only, headers only), sorted by the same
 * triage rules as the inbox, for the Career Agent's one-time catch-up. Nothing is stored
 * here; the caller logs applications from what it finds.
 */
export async function findJobMail(store: Store, days: number): Promise<JobMailResult> {
  const imap = await loadConnection("gmail_imap");
  if (!imap) return { status: "not_connected" };
  try {
    const [mails, contacts] = await Promise.all([searchJobMailImap({ user: imap.email, pass: imap.secret }, days), store.contacts.list()]);
    const now = new Date().toISOString();
    return {
      status: "ok",
      items: mails
        .filter((m) => !m.labelIds.includes("SENT"))
        .map((m) => {
          const t = triage(m, contacts, imap.email);
          return {
            id: m.id,
            messageId: m.id,
            threadId: m.threadId,
            fromName: t.fromName,
            fromEmail: t.fromEmail,
            subject: m.subject.slice(0, 300),
            snippet: "",
            receivedAt: m.receivedAt,
            category: t.category,
            reason: t.reason.slice(0, 120),
            done: false,
            createdAt: now,
          };
        }),
    };
  } catch {
    return { status: "error", message: "Could not search Gmail. Nothing was changed." };
  }
}
