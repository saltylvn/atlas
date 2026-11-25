import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { demoPdf } from "@/lib/data/demoResumeFiles";
import { TEST_COMPANY, TEST_FORM } from "@/lib/domain/applyTest";
import { buildPacket, editAnswer, fitPacket, MAX_PACKET_CHARS, packetProblems, type FormQuestion } from "@/lib/domain/applyPacket";
import { NOT_CHECKED, readability, selectable } from "@/lib/domain/pdfReadable";
import { resumeSourcesFromNotion } from "@/lib/domain/notionRoles";
import { downloadResumeFile, NOTION_FILE_HOST } from "@/lib/integrations/notion";
import { checkProof, fileForRole, frameLink, proofLine, resumeFileName, resumePath } from "@/lib/domain/resumeProof";
import { docText, isResumeSyncDay, resumeFromFigma, weeklyResumeNotice, emptyReport } from "@/lib/domain/resumeSync";
import type { Eligibility, PacketItem, ResumeProof } from "@/lib/domain/types";
import { pdfText } from "@/lib/integrations/pdfText";
import { ALLOWED_HOSTS } from "@/lib/security/safeFetch";
import { resumeFrame } from "./helpers/resumeFrame";

// The answer rules Atlas Autofill uses on a form, and the resume checks behind them. (Split
// from the Apply bot's tests when the bot was removed, 23 Nov 2026.)

const ANSWERS = { fullName: "Tyler Clark", email: "tyler@example.com", phone: "801-555-0100", city: "Salt Lake City, UT", links: "https://www.linkedin.com/in/tyler-example https://github.com/tyler-example", whyCompany: "I'm excited about {company} because of its integrations work." };
const ELIGIBLE: Eligibility = { authorized: "yes", sponsorship: "no", workedHere: "no" };
const YES_NO = [{ label: "Yes", value: "1" }, { label: "No", value: "0" }];

const QUESTIONS: FormQuestion[] = [
  { name: "first_name", label: "First Name", required: true, kind: "text" },
  { name: "last_name", label: "Last Name", required: true, kind: "text" },
  { name: "email", label: "Email", required: true, kind: "text" },
  { name: "phone", label: "Phone", required: true, kind: "text" },
  { name: "resume", label: "Resume/CV", required: true, kind: "file" },
  { name: "question_1", label: "Are you legally authorized to work in the United States?", required: true, kind: "select", options: YES_NO },
  { name: "question_2", label: "Will you now or in the future require sponsorship for employment visa status?", required: true, kind: "select", options: YES_NO },
  { name: "question_3", label: "Why do you want to work at Mock Co?", required: false, kind: "textarea" },
  { name: "gender", label: "Gender", required: false, kind: "select", options: [{ label: "Male", value: "1" }, { label: "Female", value: "2" }, { label: "I don't wish to answer", value: "3" }] },
  { name: "location", label: "Location (City)", required: true, kind: "typeahead" },
  { name: "country", label: "Country (phone number)", required: false, kind: "typeahead" },
];


const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n" + "resume ".repeat(60)));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const packet = (): PacketItem[] => buildPacket({ questions: QUESTIONS, answers: ANSWERS, eligibility: ELIGIBLE, job: { company: "Mock Co", role: "Solutions Engineer" }, resumeReady: true }).items;

describe("Your edits in the review", () => {
  it("lets you change an answer, but only to one of the form's own choices, and never a locked one", () => {
    const items = packet();
    const edited = editAnswer(items, "question_1", "No")!;
    expect(edited.find((i) => i.name === "question_1")).toMatchObject({ source: "you", value: "No", optionValue: "0" });
    expect(editAnswer(items, "question_1", "Maybe")).toBeNull();
    expect(editAnswer(items, "gender", "Male")).toBeNull();
    expect(editAnswer(items, "resume", "other.pdf")).toBeNull();
    expect(editAnswer(items, "question_3", "  My own words.  ")!.find((i) => i.name === "question_3")).toMatchObject({ source: "you", value: "My own words." });
  });

  it("says what a packet still needs from the packet itself", () => {
    expect(packetProblems(packet(), true)).toEqual({ blocked: [], needsYou: [] });
    const open = buildPacket({ questions: [...QUESTIONS, { name: "q9", label: "Describe an integration you built.", required: true, kind: "textarea" }], answers: ANSWERS, eligibility: ELIGIBLE, job: { company: "Mock Co", role: "Solutions Engineer" }, resumeReady: true }).items;
    expect(packetProblems(open, true).needsYou).toEqual(['"Describe an integration you built." needs an answer']);
    expect(packetProblems(editAnswer(open, "q9", "I built a billing sync.")!, true).needsYou).toEqual([]);
    // No resume PDF: prepare again, not "apply yourself".
    const noResume = buildPacket({ questions: QUESTIONS, answers: ANSWERS, eligibility: ELIGIBLE, job: { company: "Mock Co", role: "Solutions Engineer" }, resumeReady: false }).items;
    expect(packetProblems(noResume, false)).toEqual({ blocked: [], needsYou: ['"Resume/CV" needs the resume PDF, which is not ready: prepare this application again'] });
  });

  it("keeps a packet with very long choice lists inside what the database stores, without cutting an answer", () => {
    const countries = Array.from({ length: 200 }, (_, n) => ({ label: `Country number ${n} with a long official name of state`, value: String(n) }));
    const many: FormQuestion[] = [...QUESTIONS, ...Array.from({ length: 8 }, (_, n) => ({ name: `c${n}`, label: `Country ${n}`, required: false, kind: "select" as const, options: countries }))];
    const items = buildPacket({ questions: many, answers: ANSWERS, eligibility: ELIGIBLE, job: { company: "Mock Co", role: "Solutions Engineer" }, resumeReady: true }).items;
    expect(JSON.stringify(items).length).toBeGreaterThan(MAX_PACKET_CHARS);
    const fit = fitPacket(items);
    expect(JSON.stringify(fit).length).toBeLessThanOrEqual(MAX_PACKET_CHARS);
    expect(fit.map((i) => [i.name, i.value])).toEqual(items.map((i) => [i.name, i.value]));
    expect(fit.find((i) => i.name === "question_1")?.options).toEqual(YES_NO);
  });
});

describe("The resume that is sent is the Figma frame you approved", () => {
  const ref = { fileKey: "AbCdEfGhIjKlMnOpQrStUv", nodeId: "201:2" };
  const proof: ResumeProof = { resume: "Solutions Engineer", ...ref, frameFingerprint: "aaaaaaaaaaaa", pdfSha256: sha(PDF), bytes: PDF.length, path: "apply-greenhouse:mockco:4001.pdf", exportedAt: "2026-11-19T16:00:00.000Z" };

  it("picks the role's own file, a row whose old name folded into the role, else the Master Resume", () => {
    const f = (n: string) => ({ name: `${n}.pdf`, url: `https://prod-files-secure.s3.us-west-2.amazonaws.com/f/${n}.pdf` });
    const sources = [
      { role: "Master Resume", file: f("master") },
      { role: "Solutions Engineer", file: f("se") },
      { role: "AI Engineer", file: f("ai") },
      { role: "AI Workflow Engineer (uses AI Engineer)", file: null },
      { role: "AI + Automation Engineer", file: f("auto") },
      { role: "Data Engineer", file: null },
    ];
    expect(fileForRole(sources, "Solutions Engineer")).toMatchObject({ resume: "Solutions Engineer", source: { file: { name: "se.pdf" } } });
    expect(fileForRole(sources, "AI Automation Engineer")).toMatchObject({ resume: "AI + Automation Engineer", source: { file: { name: "auto.pdf" } } });
    expect(fileForRole(sources.filter((s) => s.role !== "AI + Automation Engineer"), "AI Automation Engineer")).toMatchObject({ resume: "Master Resume" });
    expect(fileForRole(sources, "Data Engineer")).toMatchObject({ resume: "Master Resume", source: { file: { name: "master.pdf" } } });
    expect(fileForRole([{ role: "Data Engineer", file: null }], "Data Engineer")).toBeNull();
  });

  it("passes only when the kept file is the approved file and Figma still reads the same", () => {
    expect(checkProof(proof, { frameFingerprint: "aaaaaaaaaaaa", pdfSha256: sha(PDF) })).toEqual({ ok: true });
    expect(checkProof(proof, { frameFingerprint: "bbbbbbbbbbbb", pdfSha256: sha(PDF) })).toEqual({ ok: false, why: "Your Solutions Engineer resume changed in Figma since you approved. Prepare it again so the new version is sent." });
    expect(checkProof(proof, { frameFingerprint: "aaaaaaaaaaaa", pdfSha256: sha(new Uint8Array([1, 2, 3])) }).ok).toBe(false);
    expect(checkProof(proof, { frameFingerprint: "aaaaaaaaaaaa", pdfSha256: null }).ok).toBe(false);
    // Figma could not be read: not knowing is a stop, never a pass.
    expect(checkProof(proof, { frameFingerprint: null, pdfSha256: sha(PDF) })).toEqual({ ok: false, why: "Figma could not be read to confirm the resume is current. Nothing was sent; try again." });
    expect(checkProof(undefined, { frameFingerprint: "aaaaaaaaaaaa", pdfSha256: sha(PDF) }).ok).toBe(false);
  });

  it("names the file for a person, keeps one per posting, and shows where it came from", () => {
    expect(resumeFileName("Tyler Clark", "Solutions Engineer")).toBe("Tyler_Clark_Solutions_Engineer_Resume.pdf");
    expect(resumeFileName("", "AI Engineer")).toBe("Resume_AI_Engineer_Resume.pdf");
    expect(resumePath("greenhouse:mockco:4001")).toBe("apply-greenhouse:mockco:4001.pdf");
    expect(resumePath("url:evil.example/../../x")).toMatch(/^apply-[a-z0-9:_.-]+\.pdf$/i);
    expect(proofLine(proof, "Solutions Engineer")).toBe(`Sends your Solutions Engineer resume, exported from Figma 2026-11-19 16:00 UTC; ${Math.round(PDF.length / 1024)} KB; fingerprint ${sha(PDF).slice(0, 12)}.`);
    expect(proofLine({ ...proof, resume: "AI Engineer" }, "AI Workflow Engineer")).toContain("your AI Engineer resume (no file of its own for AI Workflow Engineer)");
    expect(frameLink(proof)).toBe("https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/?node-id=201-2");
  });
});


describe("Can a job board read the resume PDF", () => {
  const doc = resumeFromFigma(resumeFrame())!;
  const asStored = docText(doc);
  const lines = doc.lines.length;

  it("says yes when every line is in the PDF's text, in the order it reads", () => {
    const r = readability(asStored, 1, doc);
    expect(r).toEqual({ verdict: "good", pages: 1, lines, found: lines, notes: [`A job board can read this PDF: ${lines} of ${lines} lines found, in the order they read.`] });
    // Wrapped lines, bullets, different dashes and spaced-out headings are the same text.
    const messy = asStored.replace(/Experience/, "E X P E R I E N C E").replace(/ – /g, " - ").replace(/^(Automate|Configure|Designed|Built) /gm, "• $1 ").replace(/(.{60}) /g, "$1\n");
    expect(readability(messy, 1, doc).verdict).toBe("good");
  });

  it("says no when the PDF has no text: outlined or flattened in Figma", () => {
    for (const empty of ["", "   \n ", "Sam Rivera"]) {
      expect(readability(empty, 1, doc)).toMatchObject({ verdict: "bad", found: empty.trim() ? expect.any(Number) : 0, notes: [expect.stringContaining("cannot read this PDF's text")] });
    }
    // Text that is there but is not the resume (a font the PDF does not map to letters).
    expect(readability("\u0001\u0002 qwx zzkj ".repeat(200), 1, doc).verdict).toBe("bad");
  });

  it("warns when lines are missing, and names the first", () => {
    const cut = asStored.split("\n").filter((l) => !/Automate record validation|Designed and shipped/.test(l)).join("\n");
    const r = readability(cut, 1, doc);
    expect(r.verdict).toBe("warn");
    expect(r.found).toBe(lines - 2);
    expect(r.notes[0]).toBe(`2 of ${lines} lines of your resume were not found in the PDF's text, starting with "Automate record validation with custom rules that stop or c…".`);
  });

  it("warns when the text is stored in another order than it reads", () => {
    // Inside a section, bottom to top: how layers stacked by hand often export.
    const reversed = asStored.split("\n").reverse().join("\n");
    expect(readability(reversed, 1, doc)).toMatchObject({ verdict: "warn", found: lines, notes: [expect.stringContaining("different order than it reads")] });
    // Two columns read straight across: a line of one section, then a line of another.
    const parts = asStored.split("\n");
    const half = Math.ceil(parts.length / 2);
    const woven = parts.slice(0, half).flatMap((l, n) => [l, parts[half + n] ?? ""]).join("\n");
    expect(readability(woven, 1, doc).verdict).toBe("warn");
    // A sidebar stored before the main column is still whole sections, in order: fine.
    const skills = parts.findIndex((l) => l.startsWith("Skills"));
    const sidebarFirst = [...parts.slice(skills, skills + 2), ...parts.slice(0, skills), ...parts.slice(skills + 2)].join("\n");
    expect(readability(sidebarFirst, 1, doc).verdict).toBe("good");
  });

  it("mentions a second page without calling it a problem, and never guesses when it could not read", () => {
    expect(readability(asStored, 2, doc)).toMatchObject({ verdict: "good", notes: [expect.stringContaining("A job board can read"), "The PDF has 2 pages."] });
    expect(NOT_CHECKED.verdict).toBe("unknown");
    expect(readability(asStored, 1, { lines: [] }).verdict).toBe("unknown");
  });

  it("reads a real PDF's text with the library, and leaves the file's bytes untouched", async () => {
    const bytes = demoPdf("Solutions Engineer (demo resume)", ["Sam Rivera", ...asStored.split("\n")]);
    const before = sha(bytes);
    const inside = await pdfText(bytes);
    expect(inside?.pages).toBe(1);
    expect(inside?.text).toContain("Integration Analyst");
    expect(sha(bytes)).toBe(before);
    expect(readability(inside!.text, inside!.pages, doc).verdict).toBe("good");
    // Not a PDF, or a broken one: "not checked", never a pass.
    expect(await pdfText(new Uint8Array(Buffer.from("%PDF-1.7 not really a pdf")))).toBeNull();
  });

});


describe("Answers that are yours to set once", () => {
  const job = { company: "Mock Co", role: "Solutions Engineer" };
  const one = (q: FormQuestion, answers: Record<string, string> = ANSWERS, eligibility: Eligibility = ELIGIBLE) => buildPacket({ questions: [q], answers, eligibility, job, resumeReady: true });
  const GENDER: FormQuestion = { name: "gender", label: "Gender", required: false, kind: "select", options: [{ label: "Male", value: "1" }, { label: "Female", value: "2" }, { label: "I don't wish to answer", value: "3" }] };

  it("answers Gender with your own fixed answer, and declines it when you set none", () => {
    expect(one(GENDER, ANSWERS, { ...ELIGIBLE, gender: "male" }).items[0]).toMatchObject({ source: "eligibility", value: "Male", optionValue: "1" });
    expect(one(GENDER, ANSWERS, { ...ELIGIBLE, gender: "female" }).items[0]).toMatchObject({ source: "eligibility", value: "Female", optionValue: "2" });
    // Not set, or set to nothing: declined, as before.
    for (const none of [ELIGIBLE, { ...ELIGIBLE, gender: "" as const }]) expect(one(GENDER, ANSWERS, none).items[0]).toMatchObject({ source: "none", value: "I don't wish to answer", locked: true });
    // Other wordings of the same answer, and a text box.
    expect(one({ ...GENDER, label: "What is your sex?", options: [{ label: "Man", value: "m" }, { label: "Woman", value: "w" }] }, ANSWERS, { ...ELIGIBLE, gender: "male" }).items[0]).toMatchObject({ value: "Man", optionValue: "m" });
    expect(one({ name: "g", label: "Gender", required: false, kind: "text" }, ANSWERS, { ...ELIGIBLE, gender: "male" }).items[0]).toMatchObject({ source: "eligibility", value: "Male" });
    // You may still change it for one application.
    expect(editAnswer(one(GENDER, ANSWERS, { ...ELIGIBLE, gender: "male" }).items, "gender", "I don't wish to answer")).not.toBeNull();
  });

  it("never guesses a Gender choice, and answers no other demographic question", () => {
    const male = { ...ELIGIBLE, gender: "male" as const };
    // Two choices that both say Male: declined rather than pick one.
    expect(one({ ...GENDER, options: [{ label: "Male", value: "1" }, { label: "Male (transgender)", value: "2" }, { label: "Decline to state", value: "3" }] }, ANSWERS, male).items[0]).toMatchObject({ source: "none", value: "Decline to state" });
    // No choice says it plainly, and none declines: left blank, or a stop when required.
    expect(one({ ...GENDER, options: [{ label: "Option A", value: "1" }] }, ANSWERS, male).items[0]).toMatchObject({ source: "none", value: "" });
    expect(one({ ...GENDER, required: true, options: [{ label: "Option A", value: "1" }] }, ANSWERS, male).stops).toHaveLength(1);
    // "Female" never matches a Male answer.
    expect(one({ ...GENDER, options: [{ label: "Female", value: "2" }, { label: "Prefer not to say", value: "3" }] }, ANSWERS, male).items[0]).toMatchObject({ value: "Prefer not to say" });
    for (const label of ["Are you a veteran?", "Race / Ethnicity", "Do you have a disability?", "Do you identify as transgender?", "Sexual orientation", "What are your pronouns?", "Gender pronouns"]) {
      const item = one({ name: "q", label, required: false, kind: "select", options: [{ label: "Male", value: "1" }, { label: "Yes", value: "2" }, { label: "I don't wish to answer", value: "3" }] }, ANSWERS, male).items[0]!;
      expect([label, item.source, item.value]).toEqual([label, "none", "I don't wish to answer"]);
    }
  });

  it("uses your default answer to 'how did you hear about this job', as written", () => {
    const heard = { ...ANSWERS, heardFrom: "Company careers page" };
    for (const label of ["How did you hear about this job?", "How did you hear about us?", "Where did you first learn about this role?", "How did you find out about this position?"]) {
      expect(one({ name: "q", label, required: true, kind: "text" }, heard).items[0], label).toMatchObject({ source: "bank", value: "Company careers page" });
    }
    // Asked as a list: only when your answer is exactly one of the choices.
    const list = (options: string[], required = false) => one({ name: "q", label: "How did you hear about this job?", required, kind: "select", options: options.map((o, n) => ({ label: o, value: String(n) })) }, heard);
    expect(list(["LinkedIn", "company careers page", "Referral"]).items[0]).toMatchObject({ source: "bank", value: "company careers page", optionValue: "1" });
    expect(list(["LinkedIn", "Referral"]).items[0]).toMatchObject({ source: "none", value: "" });
    expect(list(["LinkedIn", "Referral"], true).stops).toEqual(['"How did you hear about this job?" offers choices, and your saved answer is not one of them']);
    // You can then pick one of the form's own choices in the review.
    expect(editAnswer(list(["LinkedIn", "Referral"], true).items, "q", "Referral")).not.toBeNull();
    // Nothing saved: nothing is made up.
    expect(one({ name: "q", label: "How did you hear about this job?", required: false, kind: "text" }).items[0]).toMatchObject({ source: "none", value: "" });
  });

  it("shows both on the sample form of a test application", () => {
    const items = buildPacket({ questions: TEST_FORM, answers: { ...ANSWERS, heardFrom: "Company careers page" }, eligibility: { ...ELIGIBLE, gender: "male" }, job: { company: TEST_COMPANY, role: "Solutions Engineer" }, resumeReady: true }).items;
    expect(items.find((i) => i.name === "gender")).toMatchObject({ source: "eligibility", value: "Male" });
    expect(items.find((i) => i.name === "question_heard")).toMatchObject({ source: "bank", value: "Company careers page" });
    expect(items.find((i) => i.name === "question_linkedin")).toMatchObject({ source: "bank", value: "https://www.linkedin.com/in/tyler-example" });
  });
});

describe("Resumes come from Notion, and the Figma update is weekly", () => {
  it("reads the PDF from a row's Resume file column, and follows no link to another site", () => {
    const row = (name: string, files: unknown[]) => ({ id: "00000000-0000-4000-8000-00000000a001", properties: { Role: { type: "title", title: [{ plain_text: name }] }, "Resume file": { type: "files", files } } });
    const stored = { name: "Tyler_SE.pdf", type: "file", file: { url: `https://${NOTION_FILE_HOST}/abc/Tyler_SE.pdf?X-Amz-Signature=1` } };
    const out = resumeSourcesFromNotion([row("Solutions Engineer", [stored]), row("AI Engineer", [{ name: "x.pdf", type: "external", external: { url: "https://evil.example/x.pdf" } }]), row("Data Engineer", [])]);
    expect(out.map((r) => [r.name, r.file?.name ?? null])).toEqual([["Solutions Engineer", "Tyler_SE.pdf"], ["AI Engineer", null], ["Data Engineer", null]]);
    expect(ALLOWED_HOSTS).toContain(NOTION_FILE_HOST);
  });

  it("downloads only from Notion's own file storage", async () => {
    await expect(downloadResumeFile({ name: "x.pdf", url: "https://evil.example/x.pdf" })).rejects.toMatchObject({ problem: "not_found" });
    await expect(downloadResumeFile({ name: "x.pdf", url: `https://${NOTION_FILE_HOST}.evil.example/x.pdf` })).rejects.toMatchObject({ problem: "not_found" });
    await expect(downloadResumeFile({ name: "x.pdf", url: "not a url" })).rejects.toMatchObject({ problem: "not_found" });
  });

  it("says a resume changed in Notion, not Figma, when the file was replaced after approval", () => {
    const proof: ResumeProof = { resume: "Solutions Engineer", fileKey: "", nodeId: "", frameFingerprint: "a".repeat(64), pdfSha256: "a".repeat(64), bytes: 9000, path: "apply-x.pdf", exportedAt: "2026-11-19T16:00:00.000Z", from: "notion", fileName: "Tyler_SE.pdf" };
    expect(checkProof(proof, { frameFingerprint: "a".repeat(64), pdfSha256: "a".repeat(64) })).toEqual({ ok: true });
    expect(checkProof(proof, { frameFingerprint: "b".repeat(64), pdfSha256: "a".repeat(64) })).toEqual({ ok: false, why: "Your Solutions Engineer resume changed in Notion since you approved. Prepare it again so the new version is sent." });
    expect(checkProof(proof, { frameFingerprint: null, pdfSha256: "a".repeat(64) })).toEqual({ ok: false, why: "Notion could not be read to confirm the resume is current. Nothing was sent; try again." });
    expect(proofLine(proof, "Solutions Engineer")).toBe(`Sends your Solutions Engineer resume, from Notion (Tyler_SE.pdf), copied 2026-11-19 16:00 UTC; 9 KB; fingerprint ${"a".repeat(12)}.`);
  });

  it("judges a PDF by whether its text can be selected, when there is nothing to compare it with", () => {
    expect(selectable("resume text ".repeat(100), 1)).toMatchObject({ verdict: "good", notes: [expect.stringContaining("its text is selectable")] });
    expect(selectable("", 1).verdict).toBe("bad");
    expect(selectable("Sam Rivera", 1).verdict).toBe("bad");
    expect(selectable("resume text ".repeat(100), 2).notes).toContain("The PDF has 2 pages.");
  });

  it("updates the resume text from Figma on Mondays only, and tells you every time", () => {
    expect(["2026-11-16", "2026-11-17", "2026-11-21", "2026-11-22", "2026-11-23"].map(isResumeSyncDay)).toEqual([true, false, false, false, true]);
    const none = emptyReport();
    expect(weeklyResumeNotice(none)).toEqual({ title: "Weekly resume update: no changes", body: "Your resumes in Notion already match Figma.", url: "/roles#resume-sync" });
    expect(weeklyResumeNotice({ ...none, updated: ["Solutions Engineer", "AI Engineer"] }).title).toBe("Weekly resume update: 2 resumes updated in Notion");
    expect(weeklyResumeNotice({ ...none, updated: ["AI Engineer"] }).body).toContain("put it in that row's Resume file");
    expect(weeklyResumeNotice({ ...none, conflicts: ["AI Engineer"] }).title).toBe("Weekly resume update needs a look");
    expect(weeklyResumeNotice(null, "Figma is rate-limiting requests. The next run will try again.")).toEqual({ title: "Weekly resume update did not run", body: "Figma is rate-limiting requests. The next run will try again.", url: "/roles#resume-sync" });
  });
});

