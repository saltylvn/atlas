import { describe, expect, it, beforeEach } from "vitest";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { rateLimit, resetRateLimits } from "@/lib/security/rateLimit";
import { assertAllowed } from "@/lib/security/safeFetch";
import { decide, isPublicPath } from "@/lib/supabase/gate";


describe("csp", () => {
  it("is strict in production", () => {
    const csp = buildCsp({ nonce: "abc", isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
  });
  it("makes unique nonces", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("rate limit", () => {
  beforeEach(() => resetRateLimits());
  it("blocks after the limit and recovers after the window", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 1000, 0).allowed).toBe(true);
    expect(rateLimit("k", 3, 1000, 10).allowed).toBe(false);
    expect(rateLimit("k", 3, 1000, 1001).allowed).toBe(true);
  });
});

describe("outbound allowlist (SSRF)", () => {
  it("allows listed https hosts only", () => {
    expect(assertAllowed("https://api.open-meteo.com/v1/forecast").hostname).toBe("api.open-meteo.com");
    expect(() => assertAllowed("http://api.open-meteo.com/")).toThrow();
    expect(() => assertAllowed("https://169.254.169.254/latest/meta-data")).toThrow();
    expect(() => assertAllowed("https://localhost/")).toThrow();
    expect(() => assertAllowed("https://user:pw@api.lever.co/")).toThrow();
    expect(() => assertAllowed("https://evil.example.com/")).toThrow();
  });
});

describe("access gate", () => {
  const owner = "Owner@Example.com";
  it("requires sign-in, the owner account, and MFA", () => {
    expect(decide(null, owner, true, "/")).toBe("login");
    expect(decide({ email: "other@example.com", aal: "aal2" }, owner, true, "/")).toBe("forbidden");
    expect(decide({ email: "owner@example.com", aal: "aal1" }, owner, true, "/")).toBe("mfa");
    expect(decide({ email: "owner@example.com", aal: "aal1" }, owner, true, "/mfa")).toBe("allow");
    expect(decide({ email: "owner@example.com", aal: "aal2" }, owner, true, "/")).toBe("allow");
    expect(decide({ email: "owner@example.com", aal: "aal2" }, undefined, true, "/")).toBe("forbidden");
  });
  it("keeps the public surface small", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/ingest/job-hunt")).toBe(false);
    expect(isPublicPath("/api/keepalive")).toBe(true);
    expect(isPublicPath("/api/keepalive/x")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/api/other")).toBe(false);
  });
});

