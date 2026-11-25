import { followUpEmail } from "@/lib/domain/careerPrep";
import type { Fact } from "@/lib/domain/companyResearch";
import { followUpReplies, greeting, reviewFollowUp, type FollowUpAgentOut } from "@/lib/domain/followUpAgent";
import type { EvalCase } from "../types";

// The Follow-up agent's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the code half of its
// verification. The failures that matter: a made-up number, a hook that is not used or not read,
// an email address in the body, the wrong greeting, and a measure that counts open follow-ups.

const FACTS: Fact[] = [
  { id: "a1", text: "Applied on November 12 for the Software Engineer I role at Larkspur Labs." },
  { id: "r1", text: "Headline (2026-11-20): Larkspur Labs raises $12 million to expand its scheduling platform" },
];
const BASE = { draft: followUpEmail({ company: "Larkspur Labs", role: "Software Engineer I", appliedOn: "2026-11-12" }, "Tyler"), company: "Larkspur Labs", role: "Software Engineer I", name: "Tyler", person: null };
const BODY = "Hi,\n\nI applied for the Software Engineer I role at Larkspur Labs on November 12 and wanted to follow up. Congratulations on raising $12 million to expand your scheduling platform; I would love to help the team grow it. I recently built a scheduling API with tests. Is there anything else I can share for your review?\n\nThank you,\nTyler";
const OUT: FollowUpAgentOut = { subject: "Following up on my Software Engineer I application", body: BODY, hook: { text: "Larkspur Labs raised $12 million to expand its scheduling platform.", cites: ["r1"] } };
const verdict = (o: FollowUpAgentOut, person: string | null = null) => (reviewFollowUp(o, FACTS, { ...BASE, person }).pass ? "pass" : "fail");

export const followUpCases: EvalCase[] = [
  { name: "Follow-up: a specific, cited hook used in the email passes", expected: "pass", actual: () => verdict(OUT) },
  { name: "Follow-up: a number the facts lack fails", expected: "fail", actual: () => verdict({ ...OUT, body: BODY.replace("$12 million", "$50 million") }) },
  { name: "Follow-up: a hook citing nothing read fails", expected: "fail", actual: () => verdict({ ...OUT, hook: { ...OUT.hook, cites: ["z9"] } }) },
  { name: "Follow-up: an email address in the body fails", expected: "fail", actual: () => verdict({ ...OUT, body: BODY.replace("Is there", "Reach me at me@example.com. Is there") }) },
  { name: "Follow-up: greets someone you know by first name", expected: "fail", actual: () => verdict(OUT, "Dana Whitfield") },
  { name: "Follow-up: first name greeting", expected: "Hi Dana,", actual: () => greeting("Dana Whitfield") },
  {
    name: "Follow-up: a follow-up sent two days ago with no reply is not counted yet",
    expected: "0",
    actual: () => String(followUpReplies([{ id: "f", kind: "follow-up", status: "approved", decidedAt: "2026-11-22T16:00:00Z", applicationId: "a" }], [{ id: "a", lastHeardAt: null }], new Set(), "2026-11-24").sent),
  },
];
