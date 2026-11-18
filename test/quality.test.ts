import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { TONES as promptTones } from "@/lib/ai/prompts";
import { TONES } from "@/lib/domain/tones";
import { FEED_TIMEOUT_MS } from "@/lib/security/safeFetch";

describe("speed + PWA guards", () => {
  it("keeps tones in a zod-free module that prompts re-exports", () => {
    expect(promptTones).toBe(TONES);
    expect(readFileSync("lib/domain/tones.ts", "utf8")).not.toMatch(/from "zod"/);
    // Client components must not import the AI module (it pulls zod into the bundle).
    for (const f of ["Composer", "QuickCapture"]) {
      expect(readFileSync(`components/client/${f}.tsx`, "utf8")).not.toMatch(/@\/lib\/ai\//);
    }
  });

  it("caps every page feed well under the 6s default so first paint never waits long", () => {
    for (const ms of Object.values(FEED_TIMEOUT_MS)) expect(ms).toBeLessThanOrEqual(4000);
  });

  it("ships an installable standalone manifest", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.id).toBe("/");
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    expect(m.icons?.some((i) => i.sizes === "512x512")).toBe(true);
    expect(m.shortcuts?.every((s) => s.url.startsWith("/"))).toBe(true);
  });
});
