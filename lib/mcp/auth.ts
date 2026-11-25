// Who may use Atlas's MCP endpoint, as pure rules (tested in test/mcp.test.ts). The route
// (app/api/mcp/route.ts) verifies the token's signature with Supabase first; these decide.
//
// The token must be an OAuth access token Supabase Auth issued to an MCP client (it carries a
// client_id; a browser session token does not), for the owner's account, and Claude access must
// be on in Settings. The consent that produced it was given on /oauth/consent, which the session
// gate only opens to the owner signed in with their second factor.

export interface TokenClaims {
  sub?: string;
  email?: string;
  client_id?: string | null;
  exp?: number;
}

export type McpDecision = { ok: true; clientId: string } | { ok: false; status: 401 | 403; error: string };

export function decideMcp(claims: TokenClaims | null, owner: { id: string | null; email: string | undefined }, enabled: boolean, nowSec: number): McpDecision {
  if (!claims) return { ok: false, status: 401, error: "Sign in to Atlas to connect: the token is missing, expired or not valid." };
  if (!claims.client_id) return { ok: false, status: 401, error: "This endpoint takes an OAuth token from connecting Claude, not a browser session." };
  if (typeof claims.exp === "number" && claims.exp <= nowSec) return { ok: false, status: 401, error: "The token expired. Claude will refresh it." };
  if (!owner.id || claims.sub !== owner.id || !owner.email || (claims.email ?? "").toLowerCase() !== owner.email.toLowerCase()) return { ok: false, status: 403, error: "Atlas has one owner, and this is not their account." };
  if (!enabled) return { ok: false, status: 403, error: "Claude access is off. Turn it on in Atlas Settings, under Connect Claude." };
  return { ok: true, clientId: claims.client_id };
}

/** Bearer token from an Authorization header, or null. */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header ?? "");
  return m ? m[1]! : null;
}

/** Where MCP clients find out which authorization server to use (RFC 9728). */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function resourceMetadata(origin: string, supabaseUrl: string): Record<string, unknown> {
  return { resource: `${origin}/api/mcp`, authorization_servers: [`${supabaseUrl.replace(/\/$/, "")}/auth/v1`], bearer_methods_supported: ["header"], resource_name: "Atlas" };
}

/** The consent page's id, kept across sign-in so you land back on it. Shape-checked: it goes into a URL. */
export const CONSENT_COOKIE = "atlas_consent";
export const isAuthorizationId = (v: string | null | undefined): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(v);
export const consentPath = (id: string) => `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
