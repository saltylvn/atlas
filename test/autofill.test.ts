import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { autofillData, embedJson, extensionQueue, kitCheckHref, kitId, QUEUE_MAX, splitLinks, splitName } from "@/lib/domain/autofill";
import { ANSWER_BANK, kitQuestions, prepareAnswers } from "@/lib/domain/careerPrep";

const read = (p: string) => readFileSync(p, "utf8");

/** The extension's field matcher, loaded from the file Safari runs. */
function loadClassify(): (d: { tag?: string; type?: string; autocomplete?: string; text: string }) => string | null {
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(read("extension/safari/fill.js"), sandbox);
  return sandbox.__atlasClassify as never;
}
const classify = loadClassify();
const field = (text: string, over: { type?: string; autocomplete?: string; tag?: string } = {}) => classify({ tag: "input", type: "text", autocomplete: "", text, ...over });

describe("what Atlas gives the extension", () => {
  const saved = {
    fullName: "Sam Q. Rivera",
    email: "sam@example.com",
    phone: "801-555-0100",
    city: "Denver, CO",
    links: "LinkedIn: linkedin.com/in/sam-rivera, GitHub: https://github.com/samr, portfolio https://sam.dev.",
    whyCompany: "I'd bring agent systems to {company} as a {role}.",
    authorization: "Yes, no sponsorship needed.",
  };
  const d = autofillData(saved, new Date("2026-11-17T00:00:00Z"));

  it("splits your name and links into the fields forms ask for", () => {
    expect(d.fields).toMatchObject({ fullName: "Sam Q. Rivera", firstName: "Sam", lastName: "Rivera", linkedin: "https://linkedin.com/in/sam-rivera", github: "https://github.com/samr", portfolio: "https://sam.dev" });
    expect(splitName("Cher")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitLinks("no links here")).toEqual({ linkedin: "", github: "", portfolio: "" });
  });

  it("keeps {company} and {role} for the extension to fill per application, and uses starters where you wrote nothing", () => {
    expect(d.fields.whyCompany).toBe("I'd bring agent systems to {company} as a {role}.");
    expect(d.fields.salary).toBe(ANSWER_BANK.find((q) => q.id === "salary")!.starter);
    expect(d).toMatchObject({ v: 1, at: "2026-11-17T00:00:00.000Z" });
  });

  it("never carries work authorization, even when you wrote it", () => {
    expect(JSON.stringify(d)).not.toMatch(/sponsorship|authoriz/i);
    expect(Object.keys(d.fields)).not.toContain("authorization");
  });

  it("is embedded so no answer can close the script tag", () => {
    const evil = embedJson(autofillData({ intro: "</script><script>alert(1)</script>" }));
    expect(evil).not.toContain("</script>");
    expect(JSON.parse(evil).fields.intro).toBe("</script><script>alert(1)</script>");
  });

  it("keeps contact details out of every apply kit", () => {
    for (const id of ["email", "phone", "fullName", "city"]) expect(kitQuestions().map((q) => q.id)).not.toContain(id);
    expect(prepareAnswers({ email: "sam@example.com", phone: "801-555-0100" }, { company: "Acme", role: "AI Engineer" }).map((a) => a.id)).not.toContain("email");
  });
});

describe("how the extension reads a form field", () => {
  it("knows the contact and link fields, by label, name or autocomplete hint", () => {
    expect(field("First Name *")).toBe("firstName");
    expect(field("lastName")).toBe("lastName");
    expect(field("Full name")).toBe("fullName");
    expect(field("", { autocomplete: "given-name" })).toBe("firstName");
    expect(field("Work email", { type: "email" })).toBe("email");
    expect(field("Mobile number")).toBe("phone");
    expect(field("LinkedIn Profile URL")).toBe("linkedin");
    expect(field("GitHub")).toBe("github");
    expect(field("Website or portfolio")).toBe("portfolio");
    expect(field("City")).toBe("city");
  });

  it("knows the questions in your answer bank", () => {
    expect(field("Why do you want to work at Acme?", { tag: "textarea", type: "textarea" })).toBe("whyCompany");
    expect(field("What interests you about this role?")).toBe("whyCompany");
    expect(field("Tell us about yourself")).toBe("intro");
    expect(field("Cover letter")).toBe("coverLetter");
    expect(field("Desired salary")).toBe("salary");
    // Full-time roles only: an hourly rate or weekly hours are yours to answer, never filled.
    expect(field("Expected hourly rate")).toBeNull();
    expect(field("Weekly availability")).toBeNull();
    expect(field("When can you start?")).toBe("startDate");
    expect(field("How many years of experience do you have with Python?")).toBe("yearsExperience");
    expect(field("Describe a project you're proud of")).toBe("project");
    expect(field("Describe your experience with LLMs")).toBe("aiExperience");
    expect(field("Are you open to relocation?")).toBe("location");
    expect(field("Why are you looking to leave your current role?")).toBe("whyLooking");
  });

  it("never touches the questions that are yours alone", () => {
    for (const q of [
      "Are you legally authorized to work in the United States?",
      "Will you now or in the future require sponsorship?",
      "Gender",
      "Race / Ethnicity",
      "Veteran status",
      "Disability status",
      "Pronouns",
      "Date of birth",
      "What is your current salary?",
      "Social Security Number",
      "Have you ever been convicted of a felony?",
    ]) expect([q, field(q)]).toEqual([q, null]);
  });

  it("leaves passwords, files, checkboxes and unknown fields alone", () => {
    expect(field("Email", { type: "password" })).toBeNull();
    expect(field("Resume", { type: "file" })).toBeNull();
    expect(field("I agree to the terms", { type: "checkbox" })).toBeNull();
    expect(field("Favorite color")).toBeNull();
    expect(field("")).toBeNull();
  });
});

describe("the extension's reach", () => {
  const manifest = JSON.parse(read("extension/safari/manifest.json"));
  const code = (f: string) => read(`extension/safari/${f}`);

  it("asks only for the job-application sites it works on, and Atlas itself", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "scripting", "storage"]);
    const hosts: string[] = manifest.host_permissions;
    expect(hosts[0]).toBe("https://atlas-optim.vercel.app/*");
    // No standing access to every site: each host is named, and https only.
    for (const h of hosts) expect(h, h).toMatch(/^https:\/\/(\*\.)?[a-z0-9.-]+\.[a-z]+\/\*$/);
    expect(hosts.some((h) => /<all_urls>|^\*:|^https:\/\/\*\/\*$/.test(h))).toBe(false);
    // The only script that runs by itself on Atlas is the copier, and only on its three pages.
    expect(manifest.content_scripts[0]).toEqual({ matches: ["https://atlas-optim.vercel.app/applications*", "https://atlas-optim.vercel.app/career*", "https://atlas-optim.vercel.app/settings*"], js: ["sync.js"], run_at: "document_idle" });
    // The after-submit check runs on job-application sites, never on LinkedIn, Indeed or Glassdoor.
    expect(manifest.content_scripts[1].js).toEqual(["done.js"]);
    expect(manifest.content_scripts[1].matches.some((m: string) => /linkedin|indeed|glassdoor/.test(m))).toBe(false);
  });

  it("never submits a form, never presses Enter, and clicks only through the guard that refuses anything that sends", () => {
    // Code only: a comment that says "never via form.submit()" is not a call.
    const all = ["fill.js", "form.js", "page.js", "panel.js", "popup.js", "sync.js", "done.js", "background.js"].map((f) => code(f).replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(all).not.toMatch(/\.submit\(|requestSubmit|key: "Enter"|"Enter"|keyCode: 13/);
    const form = code("form.js");
    // Every .click() in the reader is either inside click(), which asks sends() first, or the Next step, which re-checks it.
    const clicks = [...form.matchAll(/\.click\(\)/g)].length;
    expect(clicks).toBe(2);
    expect(form).toContain("function click(el) {\n    if (sends(el)) return false;");
    expect(form).toContain("if (SENDS.test(buttonText(el))) return false;");
    expect(code("fill.js")).toContain('getAttribute("aria-required")');
  });

  it("talks only to Atlas, only from the background, and shows nothing from a page as markup", () => {
    for (const f of ["fill.js", "form.js", "page.js", "panel.js", "popup.js", "sync.js", "done.js"]) expect(code(f), f).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
    const bg = code("background.js");
    expect([...bg.matchAll(/fetch\(/g)].length).toBe(1);
    expect(bg).toContain("const res = await fetch(`${await base()}${path}`");
    expect(bg).toContain('const ATLAS = "https://atlas-optim.vercel.app";');
    for (const f of ["panel.js", "popup.js"]) expect(code(f), f).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe("the Apply on MacBook queue, as the extension gets it", () => {
  const kit = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "application" as const, title: "Solutions Engineer II at Acme", detail: "Solutions Engineer · $120k · Jobicy\nAsks for: 3+ years of experience\nSkills it names: Python, RAG\nSemi-Automation: open the posting, apply on their site, then mark it submitted.", url: "https://jobicy.com/jobs/1", matchId: `m-${id}`, ...over });
  const jobs = new Map([["m-a", { title: "Solutions Engineer II, Platform", company: "Acme", role: "Solutions Engineer" }]]);

  it("names the job, the role for your answers, the resume to attach and what the posting asks", () => {
    const q = extensionQueue([kit("a")], jobs, new Set(["m-a"]), new Date("2026-11-19T20:00:00Z"));
    expect(q).toMatchObject({ v: 1, at: "2026-11-19T20:00:00.000Z" });
    expect(q.jobs).toEqual([{ id: "a", title: "Solutions Engineer II, Platform", company: "Acme", role: "Solutions Engineer II", url: "https://jobicy.com/jobs/1", resume: "Solutions Engineer", perfect: true, facts: ["Asks for: 3+ years of experience", "Skills it names: Python, RAG"] }]);
  });

  it("falls back to the kit's own title, and leaves out what cannot be opened or is not a job", () => {
    const q = extensionQueue([kit("b"), kit("c", { url: "http://insecure.test/job" }), kit("d", { url: "" }), kit("e", { kind: "follow-up" })], jobs, new Set());
    expect(q.jobs.map((j) => j.id)).toEqual(["b"]);
    expect(q.jobs[0]).toMatchObject({ title: "Solutions Engineer II", company: "Acme", resume: "", perfect: false });
  });

  it("keeps the page's order and stops at sixty", () => {
    const many = Array.from({ length: 70 }, (_, i) => kit(`k${i}`));
    const q = extensionQueue(many, new Map(), new Set());
    expect(q.jobs).toHaveLength(QUEUE_MAX);
    expect(q.jobs[0]!.id).toBe("k0");
    // Nothing a question Atlas never answers for you could ride in on.
    expect(Object.keys(q.jobs[0]!).sort()).toEqual(["company", "facts", "id", "perfect", "resume", "role", "title", "url"]);
  });

  it("links back to Atlas by a plain id only", () => {
    expect(kitCheckHref("a1b2-c3")).toBe("/career?kit=a1b2-c3#kit-check");
    expect(kitId("a1b2-c3")).toBe("a1b2-c3");
    for (const bad of [undefined, "", "../etc", "a b", "x".repeat(65), "<script>"]) expect(kitId(bad)).toBe("");
  });
});

describe("the extension's copy of the queue", () => {
  /** Runs sync.js against a pretend Atlas page and returns what it kept and what it wrote on the page. */
  function sync(page: Record<string, string>) {
    const kept: Record<string, unknown> = {};
    const status: Record<string, string> = {};
    const node = (id: string) => (id in page ? { textContent: page[id] } : id.endsWith("-status") ? { set textContent(v: string) { status[id] = v; }, setAttribute() {} } : null);
    const sandbox = { browser: { storage: { local: { set: (v: Record<string, unknown>) => (Object.assign(kept, v), { then: (f: () => void) => f() }) } } }, document: { getElementById: node }, Date, JSON, Object, Array };
    vm.createContext(sandbox);
    vm.runInContext(read("extension/safari/sync.js"), sandbox);
    return { kept: kept as { queue?: { jobs: Record<string, unknown>[] }; atlas?: unknown }, status };
  }
  const good = { id: "k1", url: "https://jobicy.com/jobs/1", title: "Solutions Engineer", company: "Acme", role: "Solutions Engineer", resume: "Solutions Engineer", perfect: true, facts: ["Asks for: 3+ years of experience"] };

  it("keeps well-formed jobs and tells the page it copied them", () => {
    const { kept, status } = sync({ "atlas-extension-queue": JSON.stringify({ v: 1, at: "2026-11-19T20:00:00.000Z", jobs: [good] }) });
    expect(kept.queue!.jobs).toEqual([good]);
    expect(status["atlas-extension-status"]).toBe("Atlas Autofill copied this queue just now: 1 job to apply to. Open it from the A in Safari's toolbar.");
    expect(kept.atlas).toBeUndefined();
  });

  it("drops a job whose link is not https or whose id is not plain, and anything that is not text", () => {
    const jobs = [good, { ...good, id: "k2", url: "javascript:alert(1)" }, { ...good, id: "../x" }, { ...good, id: "k4", title: { evil: true }, facts: "nope", perfect: "yes" }, null, "job"];
    const { kept } = sync({ "atlas-extension-queue": JSON.stringify({ v: 1, jobs }) });
    expect(kept.queue!.jobs.map((j) => j.id)).toEqual(["k1", "k4"]);
    expect(kept.queue!.jobs[1]).toMatchObject({ title: "", facts: [], perfect: false });
  });

  it("keeps nothing from a page it does not understand", () => {
    expect(sync({ "atlas-extension-queue": "not json" }).kept).toEqual({});
    expect(sync({ "atlas-extension-queue": JSON.stringify({ v: 2, jobs: [good] }) }).kept).toEqual({});
    expect(sync({}).kept).toEqual({});
  });

  it("shows what Atlas gave it as text, and reports back only by opening Atlas", () => {
    const popup = read("extension/safari/popup.js");
    expect(popup).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(popup).toContain("`${ATLAS}/career?kit=${encodeURIComponent(job.id)}#kit-check`");
    // The page that link opens asks you; the link itself changes nothing.
    const page = read("app/(app)/(career)/career/page.tsx");
    expect(page).toContain("Did you apply to this one?");
    expect(page).toContain("kitId((await searchParams).kit)");
  });
});
