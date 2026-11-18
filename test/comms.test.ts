import { describe, expect, it } from "vitest";
import {
  availableChannels,
  bestChannel,
  clipboardText,
  defaultTone,
  fillSnippet,
  handOffLink,
  lastChannels,
  parseSlackRef,
  smsStats,
  suggestPurpose,
} from "@/lib/domain/comms";
import { draftTask, templateDraft } from "@/lib/ai/prompts";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Contact } from "@/lib/domain/types";

const person = (c: Partial<Contact>): Contact => ({
  id: "c1",
  name: "Priya Raman",
  circle: "team",
  email: null,
  phone: null,
  slackTeamId: null,
  slackUserId: null,
  cadenceDays: 7,
  lastContactAt: null,
  birthday: null,
  notes: "",
  createdAt: "2026-11-01T00:00:00Z",
  ...c,
});

describe("hand-off links", () => {
  it("pre-fills Mail with an encoded subject and body", () => {
    const l = handOffLink("email", person({ email: "p+x@example.com" }), "Lunch & demo?", "Hi\nthere")!;
    expect(l.href).toBe("mailto:p%2Bx%40example.com?subject=Lunch%20%26%20demo%3F&body=Hi%0Athere");
    expect(l.copyFirst).toBe(false);
  });
  it("pre-fills Messages and strips phone formatting", () => {
    expect(handOffLink("sms", person({ phone: "+1 (555) 555-0100" }), "", "On my way")!.href).toBe("sms:+15555550100?&body=On%20my%20way");
  });
  it("opens the Slack DM, copies first, and offers a web fallback", () => {
    const l = handOffLink("slack", person({ slackTeamId: "T0DEMO1234", slackUserId: "U0PRIYA001" }), "", "hey")!;
    expect(l.href).toBe("slack://user?team=T0DEMO1234&id=U0PRIYA001");
    expect(l.fallbackHref).toBe("https://app.slack.com/client/T0DEMO1234/U0PRIYA001");
    expect(l.copyFirst).toBe(true);
  });
  it("returns null when the channel is missing or the Slack IDs are malformed", () => {
    expect(handOffLink("email", person({}), "s", "b")).toBeNull();
    expect(handOffLink("sms", person({}), "", "b")).toBeNull();
    expect(handOffLink("slack", person({ slackTeamId: "T0DEMO1234" }), "", "b")).toBeNull();
    expect(handOffLink("slack", person({ slackTeamId: "javascript:x", slackUserId: "U0PRIYA001" }), "", "b")).toBeNull();
  });
  it("keeps the subject when copying an email", () => {
    expect(clipboardText("email", "Hello", "Body")).toBe("Hello\n\nBody");
    expect(clipboardText("slack", "ignored", "Body")).toBe("Body");
  });
});

describe("slack refs", () => {
  it("reads IDs from a member ID, T/U pair, or app.slack.com link", () => {
    expect(parseSlackRef("U012AB3CD")).toEqual({ teamId: null, userId: "U012AB3CD" });
    expect(parseSlackRef("T012AB3CD/U012AB3CD")).toEqual({ teamId: "T012AB3CD", userId: "U012AB3CD" });
    expect(parseSlackRef("https://app.slack.com/client/T012AB3CD/U045EF6GH")).toEqual({ teamId: "T012AB3CD", userId: "U045EF6GH" });
    expect(parseSlackRef("  ")).toEqual({ teamId: null, userId: null });
    expect(parseSlackRef("hello")).toEqual({ teamId: null, userId: null });
  });
});

describe("channel choice", () => {
  const all = { email: "a@b.co", phone: "+15555550100", slackTeamId: "T0DEMO1234", slackUserId: "U0PRIYA001" };
  it("lists only reachable channels", () => {
    expect(availableChannels(person({ email: "a@b.co" }))).toEqual(["email"]);
    expect(availableChannels(person(all))).toEqual(["email", "sms", "slack"]);
  });
  it("prefers Slack for team, texts for family, email for network", () => {
    expect(bestChannel(person({ ...all, circle: "team" }))).toBe("slack");
    expect(bestChannel(person({ ...all, circle: "family" }))).toBe("sms");
    expect(bestChannel(person({ ...all, circle: "network" }))).toBe("email");
    expect(bestChannel(person({ circle: "team", email: "a@b.co" }))).toBe("email");
  });
  it("reuses the last channel when it still works", () => {
    expect(bestChannel(person({ ...all, circle: "team" }), "sms")).toBe("sms");
    expect(bestChannel(person({ circle: "team", email: "a@b.co" }), "slack")).toBe("email");
  });
  it("starts with a tone that fits the relationship", () => {
    expect(defaultTone("team")).toBe("concise");
    expect(defaultTone("family")).toBe("warm");
    expect(defaultTone("network")).toBe("formal");
  });
  it("finds the latest handed-off channel per contact", () => {
    const m = lastChannels([
      { contactId: "a", channel: "email", status: "handed_off", handedOffAt: "2026-11-01T00:00:00Z" },
      { contactId: "a", channel: "slack", status: "handed_off", handedOffAt: "2026-11-05T00:00:00Z" },
      { contactId: "a", channel: "sms", status: "draft", handedOffAt: null },
      { contactId: "b", channel: "sms", status: "handed_off", handedOffAt: "2026-11-02T00:00:00Z" },
    ]);
    expect(m.get("a")).toBe("slack");
    expect(m.get("b")).toBe("sms");
  });
});

describe("quick send helpers", () => {
  it("suggests a purpose from why someone is due", () => {
    expect(suggestPurpose(person({}), { reason: "birthday", days: 0 })).toBe("Happy birthday!");
    expect(suggestPurpose(person({ circle: "network" }), { reason: "never", days: 0 })).toMatch(/stay in touch/);
    expect(suggestPurpose(person({ circle: "friends", notes: "Ask about the new job" }), { reason: "cadence", days: 9 })).toBe(
      "Checking in. How's the new job going?",
    );
    expect(suggestPurpose(person({ circle: "team" }), null)).toMatch(/anything you need/);
  });
  it("counts SMS segments for plain and unicode text", () => {
    expect(smsStats("")).toEqual({ chars: 0, segments: 0, unicode: false });
    expect(smsStats("a".repeat(160)).segments).toBe(1);
    expect(smsStats("a".repeat(161)).segments).toBe(2);
    expect(smsStats("hi 👋").unicode).toBe(true);
    expect(smsStats("é".repeat(70)).unicode).toBe(false);
    expect(smsStats("ç".repeat(71)).segments).toBe(2);
  });
  it("fills snippet placeholders", () => {
    expect(fillSnippet("Hey {first}, it's {me}. ({name})", { name: "Jordan (brother)" }, "Tyler")).toBe("Hey Jordan, it's Tyler. (Jordan (brother))");
  });
});

describe("slack drafts", () => {
  it("writes short, casual Slack messages with no sign-off", () => {
    const d = templateDraft(person({}), "Got 5 min to look at the onboarding doc", "slack", "Tyler");
    expect(d.subject).toBe("");
    expect(d.body).toBe("Hey Priya! Got 5 min to look at the onboarding doc?");
    expect(d.body).not.toContain("Tyler");
    expect(templateDraft(person({}), "Happy birthday!", "slack", "Tyler").body).toBe("Hey Priya! Happy birthday!");
  });
  it("does not double punctuation in texts", () => {
    expect(templateDraft(person({ name: "Mom", circle: "family" }), "Happy birthday!", "sms", "Tyler").body).toBe("Hey Mom, happy birthday! – Tyler");
  });
  it("tells Claude to keep Slack casual and subject-free", () => {
    expect(draftTask("slack", "warm")).toMatch(/Slack direct message.*casual/);
    expect(draftTask("slack", "warm")).toMatch(/empty subject/);
  });
  it("seeds Slack IDs and snippets in demo mode", async () => {
    const s = seedState(new Date("2026-11-11T15:00:00Z"));
    expect(s.contacts.filter((c) => c.slackUserId).length).toBe(2);
    const store = createMemoryStore(s);
    const snippets = await store.snippets.list();
    expect(snippets.map((x) => x.channel).sort()).toEqual(["email", "slack", "sms"]);
    await store.snippets.create({ channel: "slack", title: "Thanks", body: "Thanks {first}!" });
    expect((await store.snippets.list()).length).toBe(4);
  });
});
