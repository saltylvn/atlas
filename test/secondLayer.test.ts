import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MACHINE_ROUTES } from "@/lib/domain/refusedTokens";
import { isPublicIPv6 } from "@/lib/security/oneClick";
import { BlockedRequestError, safeFetchText } from "@/lib/security/safeFetch";

// Regression guards from the second security review (docs/SECURITY-REVIEW.md, 18 November 2026).

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });

describe("Outbound requests: a token never follows a redirect to another origin", () => {
  afterEach(() => vi.unstubAllGlobals());
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it("refuses a cross-origin redirect when the request carries headers, even to an allowlisted host", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://techcrunch.com/collect"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetchText("https://api.notion.com/v1/users/me", { headers: { authorization: "Bearer test-token" } })).rejects.toBeInstanceOf(BlockedRequestError);
    // The token went to the first host only.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a cross-origin redirect for a request with a body", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://api.github.com/x"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetchText("https://oauth2.googleapis.com/token", { method: "POST", body: "code=abc" })).rejects.toBeInstanceOf(BlockedRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still follows a same-origin redirect with its headers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("/v1/users/me2")).mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetchText("https://api.notion.com/v1/users/me", { headers: { authorization: "Bearer test-token" } })).resolves.toBe("ok");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://api.notion.com/v1/users/me2");
    expect((fetchMock.mock.calls[1]![1] as { headers: Record<string, string> }).headers.authorization).toBe("Bearer test-token");
  });

  it("still follows a redirect between allowlisted hosts for a plain public read", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirect("https://www.theverge.com/rss/index.xml")).mockResolvedValueOnce(new Response("<rss/>"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetchText("https://techcrunch.com/feed/")).resolves.toBe("<rss/>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses any redirect to a host off the allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(redirect("https://evil.example.com/x")));
    await expect(safeFetchText("https://techcrunch.com/feed/")).rejects.toBeInstanceOf(BlockedRequestError);
  });
});

describe("One-click unsubscribe: IPv4 addresses hidden inside IPv6", () => {
  it("judges an IPv4-mapped address by the IPv4 address it reaches, dotted or hex", () => {
    for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:a00:1", "::ffff:c0a8:101", "::127.0.0.1"]) expect(isPublicIPv6(ip)).toBe(false);
    expect(isPublicIPv6("::ffff:808:808")).toBe(true);
    expect(isPublicIPv6("::ffff:8.8.8.8")).toBe(true);
  });

  it("refuses tunnel prefixes that carry an IPv4 address (6to4, Teredo)", () => {
    for (const ip of ["2002:a9fe:a9fe::1", "2002:7f00:1::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::1", "2001:0000:1::2"]) expect(isPublicIPv6(ip)).toBe(false);
  });

  it("still accepts ordinary public addresses", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e"]) expect(isPublicIPv6(ip)).toBe(true);
  });
});

describe("Autofill extension: only fields a person can see are filled", () => {
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(read("extension/safari/fill.js"), sandbox);
  const visible = sandbox.__atlasVisible as (el: unknown) => boolean;

  type Style = { display?: string; visibility?: string; opacity?: string };
  const style = (over: Style = {}) => ({ display: "block", visibility: "visible", opacity: "1", ...over });
  /** A fake field. `styles` runs from the field outwards through its ancestors. */
  function field(over: { rect?: Record<string, number>; styles?: Style[]; disabled?: boolean; readOnly?: boolean; rects?: number; scrollX?: number; scrollY?: number } = {}) {
    const chain = (over.styles ?? [{}]).map(style);
    const view = { scrollX: over.scrollX ?? 0, scrollY: over.scrollY ?? 0, getComputedStyle: (n: { s: unknown }) => n.s };
    let parent: unknown = null;
    for (let i = chain.length - 1; i >= 1; i--) parent = { nodeType: 1, parentElement: parent, s: chain[i] };
    return {
      nodeType: 1,
      parentElement: parent,
      s: chain[0],
      disabled: Boolean(over.disabled),
      readOnly: Boolean(over.readOnly),
      ownerDocument: { defaultView: view },
      getClientRects: () => ({ length: over.rects ?? 1 }),
      getBoundingClientRect: () => ({ width: 240, height: 36, right: 340, bottom: 236, ...over.rect }),
    };
  }

  it("fills an ordinary field, including one further down the page", () => {
    expect(visible(field())).toBe(true);
    expect(visible(field({ rect: { bottom: 6000 } }))).toBe(true);
    expect(visible(field({ rect: { right: -100 }, scrollX: 400 }))).toBe(true);
  });

  it("leaves hidden, see-through, pinhole and off-page fields alone", () => {
    expect(visible(field({ disabled: true }))).toBe(false);
    expect(visible(field({ readOnly: true }))).toBe(false);
    expect(visible(field({ rects: 0 }))).toBe(false);
    expect(visible(field({ styles: [{ visibility: "hidden" }] }))).toBe(false);
    expect(visible(field({ styles: [{ opacity: "0" }] }))).toBe(false);
    expect(visible(field({ styles: [{}, {}, { opacity: "0.01" }] }))).toBe(false);
    expect(visible(field({ styles: [{}, { display: "none" }] }))).toBe(false);
    expect(visible(field({ rect: { width: 1, height: 1 } }))).toBe(false);
    expect(visible(field({ rect: { right: -9000 } }))).toBe(false);
    expect(visible(field({ rect: { bottom: -9000 } }))).toBe(false);
  });
});

describe("Machine endpoints and the setup page give nothing away", () => {
  it("the keep-alive route checks the token before it says anything about configuration", () => {
    const src = read("app/api/keepalive/route.ts");
    expect(src.indexOf("bearerMatches(")).toBeGreaterThan(-1);
    expect(src.indexOf("bearerMatches(")).toBeLessThan(src.indexOf("not configured"));
    expect(src.indexOf("bearerMatches(")).toBeLessThan(src.indexOf("rateLimit("));
  });

  it("a configured deployment redirects /setup instead of serving it", () => {
    const src = read("lib/supabase/proxy.ts");
    expect(src).toContain('if (path === "/setup") return redirect(request, response, "/");');
    expect(src.indexOf('path === "/setup"')).toBeLessThan(src.indexOf("isPublicPath(path)"));
  });
});

// "Record refused tokens", built after the review: a missing or wrong token leaves a
// throttled record in the audit trail, and the weekly QA review counts them.
describe("A refused token on a machine endpoint leaves a trace", () => {
  const sources = [...walk("app"), ...walk("lib")].filter((f) => /\.tsx?$/.test(f));
  /** Each place a token is refused: from the check to the 401 that answers it. */
  const refusals = sources.flatMap((file) => {
    const src = read(file);
    return [...src.matchAll(/if \(!bearerMatches\(/g)].map((m) => ({ file, block: src.slice(m.index, src.indexOf("status: 401", m.index)) }));
  });
  /** A file without its comments, so a word in a comment is not taken for code. */
  const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the list of machine routes is every API route behind a bearer token", () => {
    const gated = walk("app/api")
      .filter((f) => f.endsWith("route.ts") && /bearerMatches\(|handleCron\(|handleSync\(|handleWatch\(/.test(read(f)))
      .map((f) => `/${f.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`);
    expect(gated.sort()).toEqual([...MACHINE_ROUTES].sort());
  });

  it("every place that refuses a token records the refusal before it answers 401", () => {
    expect(refusals.map((r) => r.file).sort()).toEqual(["app/api/capture/route.ts", "app/api/keepalive/route.ts", "lib/agents/cron.ts", "lib/agents/sync.ts", "lib/agents/watch.ts"]);
    for (const r of refusals) {
      expect(r.block, r.file).toMatch(/noteRefusedToken\((?:"\/api\/[a-z/]+"|`\/api\/cron\/\$\{wanted\}`), request\.headers\.get\("authorization"\)\);/);
      // The route is a fixed path from the list, never one read from the request.
      const named = /noteRefusedToken\("(\/api\/[a-z/]+)"/.exec(r.block)?.[1];
      if (named) expect(MACHINE_ROUTES as readonly string[], r.file).toContain(named);
      // Nothing is awaited between the check and the answer: the 401 does not wait for the record.
      expect(r.block, r.file).not.toContain("await");
    }
    // No token check answers 401 anywhere else.
    expect(sources.filter((f) => f !== "lib/security/bearer.ts" && /bearerMatches\(/.test(code(f))).sort()).toEqual(refusals.map((r) => r.file).sort());
  });

  it("the token check still comes before any other answer, on every machine route", () => {
    for (const { file } of refusals) {
      const src = read(file);
      const check = src.indexOf("if (!bearerMatches(");
      expect(check, file).toBeGreaterThan(-1);
      expect(check, file).toBeLessThan(src.indexOf("noteRefusedToken(", check));
      expect(check, file).toBeLessThan(src.indexOf("NextResponse.json("));
      expect(check, file).toBeLessThan(src.indexOf('"not configured"'));
    }
  });

  it("the recorder looks at the header only to see whether it is there, and builds the row from the route and counts", () => {
    const src = code("lib/security/refusedToken.ts");
    // The header appears twice in code: where it comes in, and where it is classified.
    expect(src.match(/\bheader\b/g)).toEqual(["header", "header"]);
    expect(src).toContain("slot[refusalKind(header)] += 1;");
    expect(src).toContain("const detail = refusedDetail(route, tally);");
    expect(src).toContain('audit(store, { actor: "system", action: TOKEN_REFUSED, target: route, detail, outcome: "denied" })');
    // What it logs when a write fails is that same detail, or the route and an error's message.
    expect([...src.matchAll(/console\.error\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['"[audit] refused tokens not recorded yet:", detail', '"[audit] refused token not recorded", route, (err as Error']);
    expect(src).not.toMatch(/createHash|createHmac|digest|\.slice\(|\.length|request|headers|user-agent|forwarded|x-real-ip|\bip\b/i);
    // The classifier answers one of two words and keeps nothing.
    const domain = code("lib/domain/refusedTokens.ts");
    const kind = domain.slice(domain.indexOf("export function refusalKind"), domain.indexOf("const count"));
    expect(kind.replace(/\s+/g, " ").trim()).toBe('export function refusalKind(header: string | null | undefined): RefusalKind { return header && header.trim() ? "wrong" : "missing"; }');
    expect(domain).not.toMatch(/createHash|createHmac|digest|node:crypto/);
  });

  it("is throttled in memory: one write per route per window, scheduled after the response", () => {
    const src = code("lib/security/refusedToken.ts");
    expect(src).toContain("export const REFUSED_WINDOW_MS = 10 * 60_000;");
    expect(src).toContain("if (now - slot.opened < REFUSED_WINDOW_MS) return;");
    expect(src).toContain("if (!TOKEN_ROUTES.includes(route) || !deps.ready()) return;");
    expect(src).toContain("after(task);");
    // The only write is the audit helper's insert: the trail stays append-only.
    expect(src).not.toMatch(/\.update\(|\.delete\(|\.upsert\(|\.from\(/);
  });

  it("needed no table or column, and no migration stores a caller's address or user agent", () => {
    const sql = walk("supabase/migrations").sort().map(read).join("\n");
    expect(sql).not.toMatch(/token\.refused|refused_token|caller_ip|ip_address|user_agent/i);
    expect(sql).toContain("outcome text not null check (outcome in ('success', 'denied', 'error'))");
  });

  it("the QA bot reads the records by rules: the route, the time and the counts", () => {
    const agent = read("lib/agents/qa.ts");
    expect(agent).toContain("byAction(TOKEN_REFUSED, since)");
    expect(agent).toContain("rows.map((r) => ({ at: r.at, target: r.target, detail: r.detail }))");
    const rules = read("lib/domain/qa.ts");
    expect(rules).toContain("export const QA_REFUSED_MIN = 5;");
    expect(rules).toContain('key: "security:refused-tokens"');
    for (const f of ["lib/domain/qa.ts", "lib/domain/refusedTokens.ts", "lib/agents/qa.ts"]) expect(read(f), f).not.toMatch(/structured|takeAiCall|safeFetch|fetch\(/);
  });
});

describe("Logs are append-only in the database, for every role", () => {
  const sql = walk("supabase/migrations").sort().map(read).join("\n");

  it("a trigger refuses UPDATE, DELETE and TRUNCATE on each log table", () => {
    expect(sql).toContain("array['audit_events', 'agent_runs', 'ai_usage', 'time_ledger']");
    expect(sql).toContain("create trigger append_only_rows before update or delete on public.%I for each row execute function private.refuse_log_change()");
    expect(sql).toContain("create trigger append_only_truncate before truncate on public.%I for each statement execute function private.refuse_log_change()");
    expect(sql).toContain("revoke execute on function private.refuse_log_change() from public, anon, authenticated");
  });

  it("the newest retention job sets the flag the triggers look for, and clears it", () => {
    const start = sql.lastIndexOf("create or replace function private.prune()");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    expect(body).toContain("select set_config('atlas.retention', 'on', true);");
    expect(body.trimEnd().endsWith("select set_config('atlas.retention', '', true);")).toBe(true);
    expect(body).toContain("delete from public.audit_events");
    expect(body).toContain("delete from public.agent_runs");
  });

  it("the app itself only ever inserts into the log tables", () => {
    const store = read("lib/data/supabase.ts");
    for (const t of ["audit_events", "agent_runs", "ai_usage", "time_ledger"]) {
      expect(new RegExp(`from\\("${t}"\\)\\s*\\.(update|delete|upsert)\\(`).test(store)).toBe(false);
    }
  });
});
