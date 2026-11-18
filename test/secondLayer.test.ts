import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
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
