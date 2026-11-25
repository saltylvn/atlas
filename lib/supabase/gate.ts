// Pure access decision shared by proxy.ts and the data-access layer, so the rule
// lives in one tested place. NIST SP 800-63B AAL2: a second factor is required.

export interface Claims {
  email?: string;
  aal?: string;
}

export type GateDecision = "allow" | "login" | "mfa" | "forbidden";

export function decide(
  claims: Claims | null,
  owner: string | undefined,
  requireMfa: boolean,
  path: string,
): GateDecision {
  if (!claims) return "login";
  if (!owner || (claims.email ?? "").toLowerCase() !== owner.toLowerCase()) return "forbidden";
  if (requireMfa && claims.aal !== "aal2" && path !== "/mfa") return "mfa";
  return "allow";
}

/** Paths reachable without a session. Everything else is gated. */
export function isPublicPath(path: string): boolean {
  // Pages anyone may load, and machine endpoints that check their own bearer token
  // instead of a browser session. Keep this list short: everything else is gated.
  return (
    path === "/login" ||
    // The privacy policy and terms: static, linked from Google's consent screen.
    path === "/privacy" ||
    path === "/terms" ||
    path === "/setup" ||
    path === "/sw.js" ||
    path.startsWith("/auth/") ||
    path === "/api/health" ||
    path === "/api/keepalive" ||
    path === "/api/capture" ||
    path.startsWith("/api/cron/") ||
    // Atlas Autofill: each route checks the extension's key (lib/extensionApi.ts).
    path.startsWith("/api/extension/") ||
    // Claude's MCP connector: checks its own OAuth token (lib/mcp/auth.ts); its metadata is public.
    path === "/api/mcp" ||
    // The public demo connector: fictional data only, off unless ATLAS_MCP_DEMO is set (lib/mcp/showcase.ts).
    path === "/api/mcp-demo" ||
    path.startsWith("/.well-known/oauth-protected-resource")
  );
}

/**
 * True for a bare origin: https://host[:port], or http://localhost[:port] for local
 * development. No path, query, credentials or other scheme. The sign-in return address
 * is built from request headers, so it is checked against this before use.
 */
export function isPlainOrigin(origin: string): boolean {
  return /^(https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?|http:\/\/localhost(:\d{1,5})?)$/i.test(origin);
}
