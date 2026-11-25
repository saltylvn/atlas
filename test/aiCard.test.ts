import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The button is a client component that calls a server action; the card itself is what is under test.
vi.mock("@/components/client/AiCheckButton", () => ({ AiCheckButton: () => null }));

const { AiJudgmentCard } = await import("@/components/AiJudgmentCard");

const NOW = new Date("2026-11-17T20:30:00Z");
const run = (over: Record<string, unknown>) => ({ id: "r", runId: "r", agent: "mentor", task: "Mentor: midday check", status: "succeeded", trigger: "schedule", detail: "", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0, at: "2026-11-17T20:00:00Z", ...over }) as never;
const card = (props: Partial<Parameters<typeof AiJudgmentCard>[0]>) =>
  renderToStaticMarkup(createElement(AiJudgmentCard, { name: "Gemini", on: true, models: null, usedToday: 1, limit: 60, runs: [], now: NOW, ...props }));

describe("Mission Control's AI card", () => {
  it("shows the last connection check, model by model", () => {
    const html = card({
      models: { writer: "gemini-3.8-flash", fast: "gemini-3.5-flash-lite" },
      lastCheck: run({
        agent: "chief-of-staff",
        task: "AI connection check",
        at: "2026-11-17T20:25:00Z",
        trace: [
          { name: "Writer: gemini-3.8-flash", ms: 1200, ok: true, note: "answered in 1.2 s" },
          { name: "Fast: gemini-3.5-flash-lite", ms: 900, ok: true, note: "answered in 0.9 s" },
          { name: "Not in use: gemini-4-hydrogen", ms: 20000, ok: false, note: "no answer in time after 20.0 s" },
        ],
      }),
    });
    expect(html).toMatch(/Last check 5m? ?(min)?/);
    expect(html).toContain("gemini-4-hydrogen");
    expect(html).toContain("no answer in time after 20.0 s");
    expect(html).toContain("answered in 0.9 s");
    // Each model once in the check, with its role.
    expect(html.match(/gemini-4-hydrogen/g)).toHaveLength(1);
    expect(html).toContain("asked first");
    expect(html).toContain("fallback");
    expect(html).toContain("not in use");
  });

  it("says why an agent used its rules, in the words its trace gives", () => {
    const html = card({ runs: [run({ trace: [{ name: "Judge what matters most", ms: 300, ok: true, note: "rules ranking (rate-limited (429 RESOURCE_EXHAUSTED))" }], detail: "2 insights, by rules" })] });
    expect(html).toContain("free-tier rate limit was hit");
  });
});

describe("Today's Career Mentor card", () => {
  it("stays away when nothing is open and the last review went fine, and offers a retry when it did not", async () => {
    vi.doMock("@/components/client/CareerDesk", () => ({ RefreshMentorButton: () => createElement("button", null, "Refresh and review") }));
    const { MentorCard } = await import("@/components/MentorCard");
    expect(renderToStaticMarkup(createElement(MentorCard, { insights: [] }))).toBe("");
    const html = renderToStaticMarkup(createElement(MentorCard, { insights: [], retry: "The Career Mentor's last review did not finish." }));
    expect(html).toContain("did not finish");
    expect(html).toContain("Refresh and review");
  });
});
