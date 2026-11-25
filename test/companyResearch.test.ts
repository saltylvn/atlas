import { describe, expect, it } from "vitest";
import { keepSound, pageFacts, parseResearchOut, readyJobs, reviewResearch, searchProblem, type Fact, type ResearchOut } from "@/lib/domain/companyResearch";

// The Company Research agent's rules (24 Nov 2026): every line cites what was read.

const FACTS: Fact[] = [
  { id: "f1", text: "Skills it names that you have: TypeScript, React" },
  { id: "n1", text: "Headline (2026-11-20): Larkspur Labs raises $12 million to expand its scheduling platform" },
  { id: "p1", text: "Larkspur Labs builds scheduling software used by 400 clinics." },
];
const good: ResearchOut = {
  about: [{ text: "Larkspur Labs builds scheduling software used by 400 clinics.", cites: ["p1"] }],
  whyThem: [{ text: "It just raised $12 million to expand its platform.", cites: ["n1"] }],
  yourAngle: [{ text: "Lead with TypeScript and React, which it names.", cites: ["f1"] }],
  questions: [{ text: "What will the new funding change for the engineering team?", cites: ["n1"] }],
};

describe("reviewResearch", () => {
  it("passes a brief where every line cites what was read", () => {
    expect(reviewResearch(good, FACTS)).toEqual({ pass: true, notes: "" });
  });

  it("sends back a made-up citation, a number the source lacks, a link, and an empty section", () => {
    expect(reviewResearch({ ...good, whyThem: [{ text: "It is growing fast in healthcare.", cites: ["p9"] }] }, FACTS).notes).toContain("cites nothing that was read");
    expect(reviewResearch({ ...good, about: [{ text: "Its software is used by 900 clinics.", cites: ["p1"] }] }, FACTS).notes).toContain("states 900");
    expect(reviewResearch({ ...good, questions: [{ text: "See https://example.com for more?", cites: ["n1"] }] }, FACTS).notes).toContain("link or markup");
    expect(reviewResearch({ ...good, yourAngle: [] }, FACTS).notes).toContain("angle");
  });

  it("wants \"about\" to rest on the web when the web gave something, and to stay empty when it gave nothing", () => {
    expect(reviewResearch({ ...good, about: [{ text: "It names TypeScript and React as skills.", cites: ["f1"] }] }, FACTS).notes).toContain("citing a headline, search result or page");
    const jobOnly = FACTS.slice(0, 1);
    expect(reviewResearch({ ...good, about: [], whyThem: [{ text: "It names skills you have.", cites: ["f1"] }], questions: [{ text: "Which of these skills matter most day to day?", cites: ["f1"] }] }, jobOnly).pass).toBe(true);
    expect(reviewResearch({ ...good, about: [{ text: "It is a leader in its field today.", cites: ["f1"] }], whyThem: [{ text: "It names skills you have.", cites: ["f1"] }], questions: [{ text: "Which skills matter most?", cites: ["f1"] }] }, jobOnly).notes).toContain("leave \"about\" empty");
  });

  it("keepSound drops only the lines that cannot stand", () => {
    const r = keepSound({ ...good, whyThem: [...good.whyThem, { text: "It has 5,000 employees worldwide.", cites: ["n1"] }] }, FACTS);
    expect(r.dropped).toBe(1);
    expect(r.out.whyThem).toHaveLength(1);
  });

  it("reads the agent's JSON answer, and nothing else", () => {
    expect(parseResearchOut(JSON.stringify(good))?.about).toHaveLength(1);
    expect(parseResearchOut("not json")).toBeNull();
    expect(parseResearchOut(JSON.stringify({ ...good, about: [{ text: "x", cites: [] }] }))).toBeNull();
  });
});

describe("what the agent may read and search", () => {
  it("keeps a few plain sentences from a page, and no navigation, cookie or link text", () => {
    const page = "Home About Careers. We use cookies to improve your experience on this site today. Larkspur Labs builds scheduling software used by 400 clinics across the country. Read more at https://example.com/blog for the full story and details. Our engineering team ships to production every day and owns what it builds.";
    expect(pageFacts(page)).toEqual(["Larkspur Labs builds scheduling software used by 400 clinics across the country.", "Our engineering team ships to production every day and owns what it builds."]);
  });

  it("searches about the company, never a person's private details", () => {
    expect(searchProblem("Larkspur Labs engineering blog", "Larkspur Labs")).toBe("");
    expect(searchProblem("best scheduling software", "Larkspur Labs")).toContain("include its name");
    expect(searchProblem("Larkspur Labs CEO home address", "Larkspur Labs")).toContain("not a person's private details");
  });
});

describe("readyJobs: what is prepared for the morning", () => {
  it("puts the most prepared jobs first, and keeps the picks' order otherwise", () => {
    const picks = [
      { kitId: "a", title: "A", url: "" },
      { kitId: "b", title: "B", url: "" },
      { kitId: "c", title: "C", url: "" },
    ];
    const r = readyJobs(picks, new Set(["b", "c"]), new Map([["c", { proven: 2, of: 3 }]]));
    expect(r.map((j) => j.kitId)).toEqual(["c", "b", "a"]);
    expect(r[0]).toMatchObject({ researched: true, pitch: { proven: 2, of: 3 } });
  });
});
