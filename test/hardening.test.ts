import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { isPublicIPv4, resolvePublicHttps, UnsafeTargetError } from "@/lib/security/oneClick";
import { open, parseKey, seal } from "@/lib/security/vault";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { isPlainOrigin } from "@/lib/supabase/gate";

// Regression guards from the security review (docs/SECURITY-REVIEW.md). Several of these
// read the source itself: they fail the build if a new server action, API route, table
// or workflow step is added without the control every other one has.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });

describe("Stored credentials (vault)", () => {
  const key = parseKey(Buffer.alloc(32, 7).toString("base64"));

  it("round-trips, and is bound to its context", () => {
    const sealed = seal(key, "app password", "gmail_imap:owner-1");
    expect(open(key, sealed, "gmail_imap:owner-1")).toBe("app password");
    expect(() => open(key, sealed, "gmail_imap:someone-else")).toThrow();
  });

  it("refuses a shortened authentication tag or a wrong-size nonce", () => {
    const [v, iv, tag, ct] = seal(key, "secret", "ctx").split(".") as [string, string, string, string];
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => open(key, [v, iv, shortTag, ct].join("."), "ctx")).toThrow("Unrecognized sealed value");
    const shortIv = Buffer.from(iv, "base64url").subarray(0, 8).toString("base64url");
    expect(() => open(key, [v, shortIv, tag, ct].join("."), "ctx")).toThrow("Unrecognized sealed value");
    expect(() => open(key, [v, iv, tag, `${ct}AA`].join("."), "ctx")).toThrow();
  });
});

describe("Session and sign-in", () => {
  it("keeps session cookies away from page scripts and cross-site requests", () => {
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    // Both server clients must use them.
    expect(read("lib/supabase/server.ts")).toContain("cookieOptions: SESSION_COOKIE_OPTIONS");
    expect(read("lib/supabase/proxy.ts")).toContain("cookieOptions: SESSION_COOKIE_OPTIONS");
    // No Supabase client ever runs in the browser.
    const client = [...walk("components"), ...walk("app")].filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /createBrowserClient|@supabase\/supabase-js/.test(read(f)));
    expect(client).toEqual([]);
  });

  it("only accepts a bare origin as the sign-in return address", () => {
    for (const ok of ["https://atlas-optim.vercel.app", "https://atlas.example.com:8443", "http://localhost:3100"]) expect(isPlainOrigin(ok)).toBe(true);
    for (const bad of ["http://atlas-optim.vercel.app", "https://evil.example/path", "https://user:pw@evil.example", "https://evil.example?x=1", "javascript:alert(1)", "https://", "//evil.example", "https://evil.example\nhttps://atlas-optim.vercel.app"]) {
      expect(isPlainOrigin(bad)).toBe(false);
    }
  });

  it("never lets a session that hasn't passed two-step sign-in add another authenticator", () => {
    const src = read("app/actions/auth.ts");
    const enroll = src.slice(src.indexOf("export async function startEnrollment"), src.indexOf("export async function verifyTotp"));
    expect(enroll).toContain("isOwnerSession(db)");
    expect(enroll.indexOf('f.status === "verified"')).toBeGreaterThan(-1);
    expect(enroll.indexOf('f.status === "verified"')).toBeLessThan(enroll.indexOf("mfa.enroll("));
    const verify = src.slice(src.indexOf("export async function verifyTotp"), src.indexOf("export async function signOutToLogin"));
    expect(verify.indexOf("isOwnerSession(db)")).toBeLessThan(verify.indexOf("challengeAndVerify"));
  });
});

describe("Every entry point is gated", () => {
  // Sign-in and MFA run before a full session exists; they check the owner themselves.
  const PRE_SESSION = ["signInWithGoogle", "startEnrollment", "verifyTotp", "signOutToLogin"];

  it("every server action goes through getContext (owner + two-step)", () => {
    const ungated: string[] = [];
    for (const file of walk("app/actions").filter((f) => f.endsWith(".ts") && !f.endsWith("_shared.ts"))) {
      for (const part of read(file).split(/\n(?=export async function )/).slice(1)) {
        const name = /^export async function (\w+)/.exec(part)![1]!;
        if (!part.includes("getContext()") && !PRE_SESSION.includes(name)) ungated.push(`${file}: ${name}`);
      }
    }
    expect(ungated).toEqual([]);
  });

  it("every API route checks a session or a bearer token", () => {
    const open_: string[] = [];
    for (const file of walk("app").filter((f) => /route\.ts$/.test(f))) {
      const src = read(file);
      const gated = /getContext\(\)|bearerMatches\(|handleCron\(|handleSync\(|handleWatch\(|exchangeCodeForSession\(|extensionContext\(|decideMcp\(/.test(src);
      if (!gated) open_.push(file);
    }
    // Liveness only: it reveals the mode and nothing else. And the MCP endpoint's OAuth metadata
    // (RFC 9728): public by design, it names the authorization server and holds no data.
    // And the public demo MCP connector: fictional data only, and it may never import a real data source.
    expect(open_).toEqual(["app/.well-known/oauth-protected-resource/[[...rest]]/route.ts", "app/api/health/route.ts", "app/api/mcp-demo/route.ts"]);
    for (const f of ["app/api/mcp-demo/route.ts", "lib/mcp/showcase.ts"]) expect(read(f), f).not.toMatch(/@\/lib\/owner|lib\/supabase|createSupabaseStore|createServiceClient|getContext|demoStore\(/);
    expect(read("lib/agents/cron.ts")).toContain("bearerMatches(request.headers.get(\"authorization\"), env().CRON_SECRET)");
    expect(read("lib/agents/sync.ts")).toContain("bearerMatches(request.headers.get(\"authorization\"), env().CRON_SECRET)");
    // The 15-minute watch checks its own secret, never the scheduler's.
    expect(read("lib/agents/watch.ts")).toContain("bearerMatches(request.headers.get(\"authorization\"), e.ATLAS_WATCH_SECRET)");
    // The extension's routes check its key before anything else they do.
    const door = read("lib/extensionApi.ts");
    expect(door).toContain("if (!keyMatches(header, settings.extensionKey)) {");
    for (const file of walk("app/api/extension").filter((f) => f.endsWith("route.ts"))) {
      const src = read(file);
      expect(src.indexOf("await extensionContext("), file).toBeGreaterThan(-1);
      expect(src.indexOf("await extensionContext("), file).toBeLessThan(src.indexOf("request.json(") === -1 ? Infinity : src.indexOf("request.json("));
    }
  });

  it("checks the keep-alive token before counting the request against the rate limit", () => {
    const src = read("app/api/keepalive/route.ts");
    expect(src.indexOf("bearerMatches(")).toBeGreaterThan(-1);
    expect(src.indexOf("bearerMatches(")).toBeLessThan(src.indexOf("rateLimit("));
  });

  it("every table created in a migration has Row Level Security turned on", () => {
    const sql = walk("supabase/migrations").map(read).join("\n");
    const tables = [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(15);
    const missing = tables.filter((t) => !new RegExp(`alter table public\\.${t} enable row level security`).test(sql));
    expect(missing).toEqual([]);
  });
});

describe("Headers, secrets and the build pipeline", () => {
  it("sends the security headers on every response and never caches pages", async () => {
    const rules = await nextConfig.headers!();
    // Every response: the rule for all paths. The one exception is checked right below.
    const all = Object.fromEntries(rules.filter((r) => r.source !== "/api/apply/:path*").flatMap((r) => r.headers.map((h) => [h.key, h.value])));
    // Only the resume PDFs may be framed, and only by Atlas itself (its viewer page has the Back button).
    expect(rules.filter((r) => r.headers.some((h) => h.key === "X-Frame-Options" && h.value !== "DENY"))).toEqual([{ source: "/api/apply/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] }]);
    expect(all["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(all).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin" });
    expect(all["X-Robots-Tag"]).toContain("noindex");
    expect(all["Cache-Control"]).toBe("private, no-store");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("exposes only the two public Supabase values to the browser", () => {
    const names = new Set<string>();
    for (const f of [...walk("app"), ...walk("components"), ...walk("lib"), "proxy.ts", ".env.example"].filter((f) => /\.(ts|tsx|example)$/.test(f))) {
      for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
    }
    expect([...names].sort()).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("marks every secret in the environment as server-only (tainted)", () => {
    const src = read("lib/env.ts");
    const secrets = ["SUPABASE_SECRET_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "CALENDAR_ICS_URL", "NOTION_TOKEN", "ATLAS_KEEPALIVE_TOKEN", "ATLAS_VAULT_KEY", "GOOGLE_CLIENT_SECRET", "VAPID_PRIVATE_KEY", "CRON_SECRET", "ATLAS_CAPTURE_TOKEN"];
    const tainted = src.slice(src.indexOf("for (const key of ["), src.indexOf("] as const)"));
    for (const s of secrets) expect(tainted, s).toContain(`"${s}"`);
  });

  it("pins every GitHub Action to a full commit SHA", () => {
    const uses = walk(".github/workflows").flatMap((f) => [...read(f).matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });

  it("runs functions next to the database", () => {
    expect(JSON.parse(read("vercel.json")).regions).toEqual(["pdx1"]);
  });
});

describe("Outbound request to an untrusted host (one-click unsubscribe)", () => {
  it("refuses anything but a public https host name, before any connection", async () => {
    for (const bad of ["http://example.com/u", "https://127.0.0.1/u", "https://[::1]/u", "https://localhost/u", "https://printer.local/u", "https://user:pw@example.com/u", "https://example.com:8443/u", "not a url"]) {
      await expect(resolvePublicHttps(bad)).rejects.toBeInstanceOf(UnsafeTargetError);
    }
    expect(isPublicIPv4("169.254.169.254")).toBe(false);
    expect(isPublicIPv4("10.0.0.5")).toBe(false);
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
  });

  it("connects through a lookup that only ever returns the vetted address", () => {
    const src = read("lib/security/oneClick.ts");
    expect(src).toContain("lookup: (_host");
    expect(src).not.toContain("await fetch(");
  });
});
