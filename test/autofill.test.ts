import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { autofillData, embedJson, splitLinks, splitName } from "@/lib/domain/autofill";
import { ANSWER_BANK, prepareAnswers, questionsFor } from "@/lib/domain/careerPrep";

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
    for (const t of ["full-time", "gig"] as const) expect(questionsFor(t).map((q) => q.id)).not.toEqual(expect.arrayContaining(["email", "phone", "fullName", "city"]));
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
    expect(field("Expected hourly rate")).toBe("rate");
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

  it("asks for no standing access to the sites you browse", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toEqual([{ matches: ["https://atlas-optim.vercel.app/applications*"], js: ["sync.js"], run_at: "document_idle" }]);
  });

  it("never submits, clicks or sends anything", () => {
    const code = ["fill.js", "popup.js", "sync.js"].map((f) => read(`extension/safari/${f}`)).join("\n");
    expect(code).not.toMatch(/\.submit\(|requestSubmit|\.click\(\)|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(read("extension/safari/fill.js")).toContain('getAttribute("aria-required")');
  });
});
