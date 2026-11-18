import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blocksToText, resumeSourcesFromNotion } from "@/lib/domain/notionRoles";
import {
  decideSync,
  docText,
  figmaRef,
  fingerprint,
  isMirrorLabel,
  looksLikeResume,
  mirrorBlock,
  mirrorLabel,
  parseMirrorLabel,
  resumeFromFigma,
  syncSummary,
  withoutMirrorLabel,
  emptyReport,
  type FigmaNode,
  type MirrorState,
} from "@/lib/domain/resumeSync";
import { mirrorResumes, type MirrorPorts, type MirrorSource } from "@/lib/knowledge/resumeMirror";

// A resume frame shaped like the real ones: 687 wide, a sidebar at x 44 to 135, the main
// column from x 233, body text 9.5, entry titles 11, section titles 16, the name 50.
const T = (x: number, y: number, size: number, characters: string, weight = 500, extra: Partial<FigmaNode> = {}): FigmaNode => ({
  type: "TEXT",
  characters,
  style: { fontSize: size, fontWeight: weight },
  absoluteBoundingBox: { x: 1000 + x, y: 2000 + y, width: 100, height: 12 },
  ...extra,
});

function frame(over: { summary?: string; extra?: FigmaNode[] } = {}): FigmaNode {
  return {
    type: "FRAME",
    name: "Sam Rivera - AI Engineer",
    absoluteBoundingBox: { x: 1000, y: 2000, width: 687, height: 1073 },
    children: [
      { type: "FRAME", name: "Header", children: [T(233, 37, 50, "Sam Rivera", 400), T(233, 107, 11, "Summary", 600), T(233, 125, 9.5, over.summary ?? "Builds AI agent systems that are safe to run unattended: supervisor orchestration, human approval gates, evals that gate every build, and tracing on every run.")] },
      {
        type: "FRAME",
        name: "sidebar",
        children: [
          T(44, 237, 16, "Contact", 600),
          T(64, 266, 9.5, "someone@example.com", 600),
          T(64, 286, 9.5, "linkedin.com/in/someone", 600),
          T(64, 306, 9.5, "github.com/someone", 600),
          T(64, 326, 9.5, "Denver, CO", 600),
          T(44, 368, 16, "Skills", 600),
          T(52, 401, 9.5, "AI Agents", 600),
          T(123, 401, 9.5, "Evals", 600),
          T(52, 427, 9.5, "Multi-Agent Orchestration", 600),
          T(44, 681, 16, "Education", 600),
          T(44, 710, 9.5, "Example State University", 600),
          T(44, 726, 9.5, "Bachelor of Science Degree"),
          T(44, 743, 9.5, "Business Information Systems"),
          T(44, 778, 9.5, "Codeschool", 600),
          T(44, 794, 9.5, "Learning Path"),
          T(44, 867, 16, "Certifications", 600),
          T(44, 893, 9.5, "Cloud Practitioner \n(In Progress)"),
          T(44, 923, 9.5, "Security Fundamentals"),
        ],
      },
      {
        type: "FRAME",
        name: "main-content",
        children: [
          T(235, 237, 16, "Experience", 600),
          T(235, 266, 11, "Integration Analyst", 600),
          T(235, 282, 9.5, "Northwind Health  |  2024 – Present"),
          T(235, 302, 11, "•"),
          T(247, 302, 9.5, "Automate record validation with custom rules that stop or correct bad records before they are sent."),
          T(235, 336, 11, "•"),
          T(247, 336, 9.5, "Configure API and file-transfer integrations that move data automatically and securely between client systems."),
          T(235, 449, 16, "Projects", 600),
          T(235, 478, 11, "Atlas | Multi-Agent Chief of Staff for Daily Operations", 600),
          T(235, 493, 9.5, "Next.js, TypeScript, Supabase (Postgres), Vercel"),
          T(235, 513, 11, "•"),
          T(247, 513, 9.5, "Designed and shipped a supervisor agent system: a Chief of Staff routes work to specialist agents and assembles two daily briefs."),
          T(235, 560, 11, "•"),
          T(247, 560, 9.5, "Built an eval suite of labeled cases that gates every build; produced $175K of nothing in particular, at about $0.33 per 1,000 messages."),
          T(247, 600, 9.5, "A hidden draft bullet that must not be read.", 500, { visible: false }),
          { type: "FRAME", name: "hidden-section", visible: false, children: [T(247, 620, 9.5, "Text inside a hidden frame.")] },
          ...(over.extra ?? []),
        ],
      },
    ],
  };
}

describe("figmaRef", () => {
  it("reads the file key and node id from a Figma design link in a row's Notes", () => {
    const notes = "Opens with agent systems. Projects: Atlas. Figma: https://www.figma.com/design/FILE000000000000000000/Tyler-Clark-Resume?node-id=201-2 https://www.figma.com/design/FILE000000000000000000/Tyler-Clark-Resume?node-id=201-2";
    expect(figmaRef(notes)).toEqual({ fileKey: "FILE000000000000000000", nodeId: "201:2" });
    expect(figmaRef("[x](https://figma.com/file/FILE000000000000000000/Name?type=design&node-id=140%3A808)")).toBeNull();
    expect(figmaRef("https://figma.com/file/FILE000000000000000000/Name?type=design&node-id=140:808&t=abc")).toEqual({ fileKey: "FILE000000000000000000", nodeId: "140:808" });
  });

  it("ignores anything that is not a Figma frame link", () => {
    for (const s of ["", "no link here", "https://www.figma.com/design/FILE000000000000000000/Tyler-Clark-Resume", "https://evil.example/figma.com/design/FILE000000000000000000/x?node-id=1-2", "http://www.figma.com/design/FILE000000000000000000/x?node-id=1-2", "https://www.figma.com/design/short/x?node-id=1-2"]) {
      expect(figmaRef(s)).toBeNull();
    }
  });

  it("is read from a Resumes row, including a link whose label is not its address", () => {
    const row = (name: string, notes: unknown) => ({ id: "417a12ce-4491-8198-8f23-e8c77e5e0373", properties: { Role: { type: "title", title: [{ plain_text: name }] }, Notes: { type: "rich_text", rich_text: notes } } });
    const linked = [{ plain_text: "Figma frame", href: "https://www.figma.com/design/FILE000000000000000000/Tyler-Clark-Resume?node-id=201-2" }];
    const out = resumeSourcesFromNotion([row("AI Engineer", linked), row("Master Resume", [{ plain_text: "No design yet" }])]);
    expect(out.map((r) => [r.name, r.figma?.nodeId ?? null])).toEqual([
      ["Master Resume", null],
      ["AI Engineer", "201:2"],
    ]);
  });
});

describe("resumeFromFigma", () => {
  const doc = resumeFromFigma(frame())!;
  const text = docText(doc);

  it("reads the sections in reading order: summary, skills, the main column, the sidebar", () => {
    expect(doc.lines.filter((l) => l.kind === "h2").map((l) => l.text)).toEqual(["Summary", "Skills", "Experience", "Projects", "Education", "Certifications"]);
    expect(looksLikeResume(doc)).toBe(true);
  });

  it("tells entry titles, sub-lines and bullets apart by size and indent", () => {
    const at = (t: string) => doc.lines.find((l) => l.text.startsWith(t))!;
    expect(at("Integration Analyst").kind).toBe("h3");
    expect(at("Northwind Health | 2024").kind).toBe("p");
    expect(at("Automate record validation").kind).toBe("li");
    expect(at("Builds AI agent systems").kind).toBe("p");
    expect(doc.lines.some((l) => l.text === "•")).toBe(false);
  });

  it("joins the skill tags, groups education under each school, and flattens line breaks", () => {
    expect(doc.lines).toContainEqual({ kind: "p", text: "AI Agents, Evals, Multi-Agent Orchestration" });
    expect(doc.lines).toContainEqual({ kind: "li", text: "Example State University: Bachelor of Science Degree, Business Information Systems" });
    expect(doc.lines).toContainEqual({ kind: "li", text: "Codeschool: Learning Path" });
    expect(doc.lines).toContainEqual({ kind: "li", text: "Cloud Practitioner (In Progress)" });
  });

  it("leaves out the name, the contact section and anything hidden", () => {
    expect(text).not.toMatch(/Sam Rivera|Contact|example\.com|linkedin|github|Denver/);
    expect(text).not.toMatch(/hidden/i);
  });

  it("drops a contact detail even when it sits outside the Contact section", () => {
    const d = resumeFromFigma(frame({ extra: [T(247, 640, 9.5, "Reach me at someone@example.com or 801-555-0142.")] }))!;
    expect(docText(d)).not.toMatch(/example\.com|555/);
  });

  it("keeps money and percentages as written", () => {
    expect(text).toContain("$175K");
    expect(text).toContain("$0.33 per 1,000 messages");
  });

  it("refuses a frame that is not a whole resume", () => {
    expect(resumeFromFigma({ type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 687, height: 100 }, children: [T(233, 10, 9.5, "Just a note")] })).toBeNull();
    expect(resumeFromFigma({ type: "FRAME", children: [] })).toBeNull();
    // Half a page: a summary and one section, as when a frame is mid-redesign.
    const whole = frame();
    const half = resumeFromFigma({ ...whole, children: [whole.children![0]!, { type: "FRAME", children: whole.children![2]!.children!.slice(0, 7) }] });
    expect(half?.lines.filter((l) => l.kind === "h2").map((l) => l.text)).toEqual(["Summary", "Experience"]);
    expect(looksLikeResume(half)).toBe(false);
    expect(looksLikeResume(null)).toBe(false);
  });
});

/** A block as Notion returns it, from the block Atlas sent. */
const asReturned = (b: Record<string, unknown>): Record<string, unknown> => {
  const type = b.type as string;
  const body = b[type] as { rich_text: { text: { content: string } }[] };
  return { id: "417a12ce-4491-8198-8f23-e8c77e5e0373", type, [type]: { rich_text: body.rich_text.map((r) => ({ plain_text: r.text.content })) } };
};

describe("the block Atlas owns on a resume page", () => {
  const doc = resumeFromFigma(frame())!;
  const block = mirrorBlock(doc, "2026-11-16") as { type: string; callout: { rich_text: { text: { content: string } }[]; children: Record<string, unknown>[] } };

  it("is one callout holding headings, paragraphs and bullets, under Notion's limits", () => {
    expect(block.type).toBe("callout");
    expect(block.callout.children.length).toBe(doc.lines.length);
    expect(block.callout.children.length).toBeLessThan(100);
    expect(new Set(block.callout.children.map((c) => c.type))).toEqual(new Set(["heading_2", "heading_3", "paragraph", "bulleted_list_item"]));
  });

  it("reads back from Notion as exactly the text that was fingerprinted", () => {
    const readBack = blocksToText(block.callout.children.map(asReturned));
    expect(readBack).toBe(docText(doc));
    const label = parseMirrorLabel(block.callout.rich_text[0]!.text.content)!;
    expect(label.bodyPrint).toBe(fingerprint(readBack));
    expect(label.figmaPrint).toBe(fingerprint(docText(doc)));
  });

  it("labels itself, and the label is kept out of the search index", () => {
    const label = mirrorLabel("2026-11-16", "a".repeat(12), "b".repeat(12));
    expect(isMirrorLabel(label)).toBe(true);
    expect(parseMirrorLabel(label)).toEqual({ figmaPrint: "a".repeat(12), bodyPrint: "b".repeat(12) });
    expect(parseMirrorLabel("Resume text, mirrored from Figma by Atlas. Typed by hand.")).toBeNull();
    expect(parseMirrorLabel("Some other callout")).toBeNull();
    expect(withoutMirrorLabel(`${label}\nSummary.\nBuilds things.`)).toBe("Summary.\nBuilds things.");
  });
});

describe("decideSync", () => {
  const state = (figmaPrint: string, bodyAsWritten: string, bodyNow: string): MirrorState => ({ label: { figmaPrint, bodyPrint: bodyAsWritten }, bodyPrint: bodyNow });

  it("writes when there is no container, or one Atlas did not stamp", () => {
    expect(decideSync("f1", null)).toBe("write");
    expect(decideSync("f1", { label: null, bodyPrint: "x" })).toBe("write");
  });

  it("does nothing when neither side changed, and writes when only Figma changed", () => {
    expect(decideSync("f1", state("f1", "b1", "b1"))).toBe("same");
    expect(decideSync("f2", state("f1", "b1", "b1"))).toBe("write");
  });

  it("never overwrites text you edited in Notion", () => {
    expect(decideSync("f1", state("f1", "b1", "edited"))).toBe("kept");
    expect(decideSync("f2", state("f1", "b1", "edited"))).toBe("conflict");
  });
});

describe("mirrorResumes", () => {
  const REF = { fileKey: "FILE000000000000000000", nodeId: "201:2" };
  const PAGE = "417a12ce-4491-8198-8f23-e8c77e5e0373";
  const sources: MirrorSource[] = [{ role: "AI Engineer", pageId: PAGE, figma: REF }];

  /** A pretend Notion page and Figma file. */
  function world(initial: FigmaNode | null = frame()) {
    const w = {
      figma: initial as FigmaNode | null,
      blocks: [] as { id: string; label: string; body: string }[],
      figmaCalls: 0,
      writes: 0,
      deleted: [] as string[],
      ports: null as unknown as MirrorPorts,
    };
    w.ports = {
      frames: async (_file, ids) => {
        w.figmaCalls++;
        return Object.fromEntries(ids.map((id) => [id, w.figma]));
      },
      mirror: async () => {
        const newest = w.blocks.at(-1);
        return { blockIds: w.blocks.map((b) => b.id), state: newest ? { label: parseMirrorLabel(newest.label), bodyPrint: fingerprint(newest.body) } : null };
      },
      write: async (_page, block, replaces) => {
        w.deleted.push(...replaces);
        if (!block) {
          w.blocks = w.blocks.filter((b) => !replaces.includes(b.id));
          return;
        }
        const c = (block as { callout: { rich_text: { text: { content: string } }[]; children: Record<string, unknown>[] } }).callout;
        w.blocks.push({ id: `block-${w.writes++}`, label: c.rich_text[0]!.text.content, body: blocksToText(c.children.map(asReturned)) });
        w.blocks = w.blocks.filter((b) => !replaces.includes(b.id));
      },
    };
    return w;
  }
  const run = (w: ReturnType<typeof world>, s = sources, deadline = Date.now() + 60_000) => mirrorResumes(s, w.ports, "2026-11-16", deadline);

  it("writes the first time, then leaves an unchanged resume alone", async () => {
    const w = world();
    expect((await run(w)).report.updated).toEqual(["AI Engineer"]);
    expect(w.blocks).toHaveLength(1);
    const again = await run(w);
    expect(again.report).toMatchObject({ updated: [], unchanged: 1 });
    expect(w.writes).toBe(1);
  });

  it("rewrites its block when the resume changes in Figma, replacing the old copy", async () => {
    const w = world();
    await run(w);
    w.figma = frame({ summary: "A new summary, long enough to stand as the opening paragraph of a resume that has changed since the last sync ran." });
    const out = await run(w);
    expect(out.report.updated).toEqual(["AI Engineer"]);
    expect(w.blocks).toHaveLength(1);
    expect(w.deleted).toEqual(["block-0"]);
    expect(w.blocks[0]!.body).toContain("A new summary");
  });

  it("removes an older copy that a failed delete left behind, without rewriting", async () => {
    const w = world();
    await run(w);
    w.blocks.unshift({ id: "stale", label: w.blocks[0]!.label, body: "old text" });
    const out = await run(w);
    expect(out.report.unchanged).toBe(1);
    expect(w.deleted).toEqual(["stale"]);
    expect(w.blocks.map((b) => b.id)).toEqual(["block-0"]);
    expect(w.writes).toBe(1);
  });

  it("keeps a hand edit, and reports a conflict when Figma changed as well", async () => {
    const w = world();
    await run(w);
    w.blocks[0]!.body += "\nA line typed in Notion.";
    expect((await run(w)).report.kept).toEqual(["AI Engineer"]);
    w.figma = frame({ summary: "Changed in Figma too, with enough words to be the opening paragraph of a full resume for this test case." });
    const out = await run(w);
    expect(out.report.conflicts).toEqual(["AI Engineer"]);
    expect(w.writes).toBe(1);
    expect(w.blocks[0]!.body).toContain("A line typed in Notion.");
  });

  it("never writes a frame that does not read as a resume, or one Figma did not return", async () => {
    for (const broken of [null, { type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 687, height: 10 }, children: [T(233, 1, 9.5, "Draft")] } as FigmaNode]) {
      const w = world(broken);
      const out = await run(w);
      expect(out.report.unreadable).toEqual(["AI Engineer"]);
      expect(w.writes).toBe(0);
    }
  });

  it("asks Figma once per file, lists rows with no link, and stops starting pages at the deadline", async () => {
    const many: MirrorSource[] = [
      { role: "AI Engineer", pageId: PAGE, figma: REF },
      { role: "GTM Engineer", pageId: PAGE, figma: { ...REF, nodeId: "201:334" } },
      { role: "AI Workflow Engineer", pageId: PAGE, figma: null },
    ];
    const w = world();
    const out = await run(w, many);
    expect(w.figmaCalls).toBe(1);
    expect(out.counts).toMatchObject({ files: 1, frames: 2 });
    expect(out.report.unlinked).toEqual(["AI Workflow Engineer"]);

    const late = world();
    const waited = await run(late, many, Date.now() - 1);
    expect(waited.report.waiting).toEqual(["AI Engineer", "GTM Engineer"]);
    expect(late.writes).toBe(0);
  });

  it("propagates a failed read instead of reporting that nothing changed", async () => {
    const w = world();
    w.ports = { ...w.ports, frames: async () => Promise.reject(new Error("figma down")) };
    await expect(run(w)).rejects.toThrow("figma down");
  });
});

describe("syncSummary", () => {
  it("says what happened in one sentence", () => {
    expect(syncSummary(emptyReport())).toBe("Resumes: nothing to sync.");
    expect(syncSummary({ ...emptyReport(), updated: ["AI Engineer"], unchanged: 6, conflicts: ["GTM Engineer"] })).toBe("Resumes: 1 updated from Figma (AI Engineer); 6 unchanged; 1 changed in both Figma and Notion, not overwritten (GTM Engineer).");
  });
});

describe("the sync's reach", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("only reads Figma", () => {
    const src = read("lib/integrations/figma.ts");
    expect(src).not.toMatch(/method:/);
    expect(src).toContain("api.figma.com");
  });

  it("writes to Notion in two named places only: its own block, and an approved role order", () => {
    const src = read("lib/integrations/notion.ts");
    const fn = (name: string) => {
      const at = src.indexOf(`export async function ${name}`);
      return src.slice(at, src.indexOf("\n}\n", at));
    };
    // PATCH: appending the mirror block, and setting a row's Priority. DELETE: the mirror's older copy.
    expect(src.match(/, "PATCH"\)/g)).toHaveLength(2);
    expect(src.match(/, "DELETE"\)/g)).toHaveLength(1);
    expect(fn("writePageMirror")).toContain('"PATCH"');
    expect(fn("writePageMirror")).toContain('"DELETE"');
    expect(fn("writeRolePriority")).toContain('"PATCH"');
    // A row is created in one place, and nothing ever deletes a row or a page.
    expect(src.match(/call\("\/pages",/g)).toHaveLength(1);
    expect(fn("createRoleRow")).toContain('call("/pages",');
    expect(src).not.toMatch(/\/pages\/[^`"]*`,\s*undefined,\s*"DELETE"/);
    expect(src).not.toMatch(/in_trash|archived:\s*true/);
  });

  it("calls no model", () => {
    for (const f of ["lib/agents/resumeSync.ts", "lib/knowledge/resumeMirror.ts", "lib/domain/resumeSync.ts"]) expect(read(f)).not.toMatch(/@\/lib\/ai\//);
  });
});

describe("the Figma token as pasted into Vercel", () => {
  it("drops the line breaks, spaces and quotes a paste can add", async () => {
    const { cleanFigmaToken } = await import("@/lib/integrations/figma");
    // Built at run time from a repeated character, so it never looks like a real key in the source.
    const token = `figd_${"x".repeat(30)}`;
    for (const pasted of [token, ` ${token}`, `${token}\n`, `"${token}"`, `'${token}'\r\n`, `\t${token} `]) expect(cleanFigmaToken(pasted)).toBe(token);
    expect(cleanFigmaToken(undefined)).toBe("");
  });
});
