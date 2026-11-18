import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { MailMeta } from "@/lib/domain/inbox";
import { safeFetchJson } from "@/lib/security/safeFetch";

// Google OAuth (authorization code + PKCE) and the Gmail API, read-only.
// Scope is gmail.readonly, and Atlas asks only for headers and Gmail's snippet
// (format=metadata): message bodies and attachments are never downloaded.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPES = ["openid", "email", GMAIL_SCOPE].join(" ");
const HEADERS = ["From", "To", "Cc", "Subject", "List-Unsubscribe", "Precedence", "Auto-Submitted"];

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeUrl(client: GoogleClient, state: string, challenge: string, loginHint?: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Always show consent so Google returns a refresh token.
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

function form(body: Record<string, string>): { method: "POST"; body: string; headers: Record<string, string> } {
  return { method: "POST", body: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

export async function exchangeCode(client: GoogleClient, code: string, verifier: string): Promise<TokenResponse> {
  return safeFetchJson<TokenResponse>("https://oauth2.googleapis.com/token", {
    ...form({
      code,
      code_verifier: verifier,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
    }),
    timeoutMs: 10_000,
  });
}

export async function refreshAccessToken(client: GoogleClient, refreshToken: string): Promise<string> {
  const res = await safeFetchJson<TokenResponse>("https://oauth2.googleapis.com/token", {
    ...form({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: "refresh_token" }),
    timeoutMs: 10_000,
  });
  return res.access_token;
}

export async function revokeToken(token: string): Promise<void> {
  await safeFetchJson("https://oauth2.googleapis.com/revoke", { ...form({ token }), timeoutMs: 8_000 }).catch(() => undefined);
}

/**
 * The account email from the ID token. The token came straight from Google's token
 * endpoint over TLS in exchange for our client secret, so its payload is trusted
 * without re-verifying the signature (OpenID Connect Core 3.1.3.7).
 */
export function idTokenEmail(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return payload.email && payload.email_verified ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Inbox messages from the last few days, as metadata only. */
export async function listInbox(accessToken: string, days = 3, max = 40): Promise<MailMeta[]> {
  const auth = { authorization: `Bearer ${accessToken}` };
  const list = await safeFetchJson<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ labelIds: "INBOX", q: `newer_than:${days}d`, maxResults: String(max) })}`,
    { headers: auth, timeoutMs: 10_000 },
  );
  const ids = (list.messages ?? []).map((m) => m.id).filter((id) => ID.test(id));

  const params = new URLSearchParams({ format: "metadata", fields: "id,threadId,labelIds,snippet,internalDate,payload/headers" });
  HEADERS.forEach((h) => params.append("metadataHeaders", h));

  const out: MailMeta[] = [];
  // Eight at a time: fast, and well under Gmail's per-user rate limit.
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map((id) =>
        safeFetchJson<GmailMessage>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`, { headers: auth, timeoutMs: 10_000 }).catch(() => null),
      ),
    );
    for (const m of batch) if (m && ID.test(m.id) && ID.test(m.threadId)) out.push(toMeta(m));
  }
  return out;
}

export function toMeta(m: GmailMessage): MailMeta {
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    id: m.id,
    threadId: m.threadId,
    from: header("From"),
    to: header("To"),
    cc: header("Cc"),
    subject: header("Subject"),
    snippet: decodeEntities(m.snippet ?? ""),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    labelIds: m.labelIds ?? [],
    listUnsubscribe: header("List-Unsubscribe") !== "",
    precedence: header("Precedence"),
    autoSubmitted: header("Auto-Submitted"),
  };
}

/** Gmail snippets arrive HTML-escaped. They are rendered as text, so decode once. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
