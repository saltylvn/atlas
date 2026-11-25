import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";

// Atlas Autofill's reader, page helper and filler, in a real browser, on a local form whose
// widgets copy the ones real job sites use (test/fixtures/extension-form.html). Nothing leaves
// the machine. Runs where Playwright's browser is installed; skipped elsewhere, CI included.

function localBrowser(): string | null {
  const named = process.env.ATLAS_TEST_BROWSER;
  if (named) return existsSync(named) ? named : null;
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse())
    for (const sub of ["chrome-mac", "chrome-headless-shell-mac-arm64", "chrome-headless-shell-mac-x64"])
      for (const bin of ["headless_shell", "chrome-headless-shell"]) {
        const path = join(cache, dir, sub, bin);
        if (existsSync(path)) return path;
      }
  return null;
}

const executablePath = localBrowser();
const FORM = pathToFileURL(join(__dirname, "fixtures", "extension-form.html")).toString();
const src = (f: string) => readFileSync(join(__dirname, "..", "extension", "safari", f), "utf8");

type Q = { id: string; label: string; required: boolean; kind: string; options: string[] };

describe.skipIf(!executablePath)("Atlas Autofill on a form like the real ones", () => {
  let browser: Browser;
  let page: Page;
  let questions: Q[];
  const byLabel = (re: RegExp) => questions.find((q) => re.test(q.label))!;

  beforeAll(async () => {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: executablePath! });
    page = await browser.newPage();
    await page.goto(FORM);
    await page.evaluate(src("page.js"));
    await page.evaluate(src("form.js"));
    questions = await page.evaluate(() => (globalThis as never as { __atlasForm: { read(): Promise<Q[]> } }).__atlasForm.read());
  }, 60_000);
  afterAll(async () => browser?.close());

  it("reads each question by the words a person reads, not placeholders, hints or invisible characters", () => {
    expect(byLabel(/^First Name/)).toMatchObject({ kind: "text", required: true });
    expect(byLabel(/^LinkedIn URL/)).toMatchObject({ kind: "text", required: true });
    expect(questions.some((q) => /Keep in mind/.test(q.label) || q.label === "Enter")).toBe(false);
    expect(byLabel(/^Gender$/)).toMatchObject({ kind: "select", options: ["Decline to answer", "Female", "Male"] });
  });

  it("reads radios, select-all checkboxes, a consent box and Yes/No buttons as their own kinds", () => {
    expect(byLabel(/legally authorized/)).toMatchObject({ kind: "select", options: ["Yes", "No"] });
    expect(byLabel(/Which tools/)).toMatchObject({ kind: "multiselect", options: ["LangGraph", "Claude Code", "Cursor"] });
    expect(byLabel(/privacy policy/)).toMatchObject({ kind: "checkbox" });
    expect(byLabel(/sponsorship/)).toMatchObject({ kind: "select", options: ["Yes", "No"] });
  });

  it("groups radios that have no name and no fieldset (Gem) into one question each", async () => {
    expect(byLabel(/live in the United States/)).toMatchObject({ kind: "select", options: ["Yes", "No"], required: true });
    expect(byLabel(/relocate/)).toMatchObject({ kind: "select", options: ["Yes", "No"], required: false });
    expect(questions.some((q) => q.label === "Yes" || q.label === "No")).toBe(false);
    const out = await page.evaluate(
      (l) => (globalThis as never as { __atlasForm: { fill(a: unknown): Promise<Record<string, string>> } }).__atlasForm.fill(l),
      [{ id: byLabel(/live in the United States/).id, value: "Yes" }, { id: byLabel(/relocate/).id, value: "No" }],
    );
    expect(Object.values(out)).toEqual(["filled", "filled"]);
    const checked = await page.evaluate(() => ["gem-us-y", "gem-us-n", "gem-re-y", "gem-re-n"].map((id) => (document.getElementById(id) as HTMLInputElement).checked));
    expect(checked).toEqual([true, false, false, true]);
  });

  it("opens a search-and-pick list to read its options, and asks the dropdown component when it will not open", () => {
    expect(byLabel(/years of professional/)).toMatchObject({ kind: "select", options: ["0", "1", "2", "3"] });
    expect(byLabel(/agriculture/)).toMatchObject({ kind: "select", options: ["Yes", "No"] });
    expect(byLabel(/Resume/)).toMatchObject({ kind: "file" });
  });

  it("never reads a password field", () => {
    expect(questions.some((q) => /password/i.test(q.label))).toBe(false);
  });

  it("finds the job from the page's own data, not the tab's title", async () => {
    const job = await page.evaluate(() => (globalThis as never as { __atlasForm: { job(): { title: string; company: string; source: string; restricted: boolean } } }).__atlasForm.job());
    expect(job).toMatchObject({ title: "Forward Deployed Engineer", company: "Northwind Labs", source: "the job's own data", restricted: false });
  });

  it("fills what you approved, picks choices, attaches the resume, and never clicks Submit", async () => {
    const answers = [
      { id: byLabel(/^First Name/).id, value: "Sam" },
      { id: byLabel(/^Gender$/).id, value: "Male" },
      { id: byLabel(/legally authorized/).id, value: "Yes" },
      { id: byLabel(/Which tools/).id, value: "Claude Code", values: ["Claude Code", "Cursor"] },
      { id: byLabel(/sponsorship/).id, value: "No" },
      { id: byLabel(/years of professional/).id, value: "2" },
      { id: byLabel(/agriculture/).id, value: "No" },
      { id: byLabel(/Resume/).id, value: "file" },
    ];
    const file = { name: "Sam_Rivera_Resume.pdf", base64: Buffer.from("%PDF-1.4 test").toString("base64") };
    const out = await page.evaluate(([a, f]) => (globalThis as never as { __atlasForm: { fill(a: unknown, f: unknown): Promise<Record<string, string>> } }).__atlasForm.fill(a, f), [answers, file] as const);
    expect(Object.values(out)).toEqual(Array(answers.length).fill("filled"));
    const state = await page.evaluate(() => ({
      first: (document.getElementById("first") as HTMLInputElement).value,
      gender: (document.getElementById("gender") as HTMLSelectElement).value,
      auth: (document.querySelector("input[name=auth]:checked") as HTMLInputElement | null)?.value,
      tools: [...document.querySelectorAll<HTMLInputElement>("input[name=tools]:checked")].map((c) => c.value),
      sponsor: document.querySelector('#ashby [data-option="no"]')!.getAttribute("aria-pressed"),
      years: (document.getElementById("years") as HTMLInputElement).dataset.picked,
      agri: (document.getElementById("agri") as HTMLInputElement).dataset.picked,
      file: (document.getElementById("resume") as HTMLInputElement).files?.[0]?.name,
      submitClicks: (window as never as { __submitClicks?: number }).__submitClicks ?? 0,
      submitted: (window as never as { __submitted?: number }).__submitted ?? 0,
    }));
    expect(state).toEqual({ first: "Sam", gender: "Male", auth: "1", tools: ["cc", "cu"], sponsor: "true", years: "2", agri: "No", file: "Sam_Rivera_Resume.pdf", submitClicks: 0, submitted: 0 });
  });

  it("leaves a field you already filled as it was", async () => {
    const out = await page.evaluate((id) => (globalThis as never as { __atlasForm: { fill(a: unknown): Promise<Record<string, string>> } }).__atlasForm.fill([{ id, value: "Someone else" }]), byLabel(/^First Name/).id);
    expect(Object.values(out)).toEqual(["already"]);
    expect(await page.inputValue("#first")).toBe("Sam");
  });

  it("offers Next as a step, refuses anything that sends, and sees the thank-you page", async () => {
    const f = () => (globalThis as never as { __atlasForm: { steps(): unknown; sends(el: Element): boolean; done(): boolean } }).__atlasForm;
    expect(await page.evaluate((fn) => new Function(`return (${fn})()`)().steps(), f.toString())).toMatchObject({ kind: "next", text: "Next", allowed: true });
    expect(await page.evaluate(() => (globalThis as never as { __atlasForm: { sends(el: Element): boolean } }).__atlasForm.sends(document.getElementById("submit")!))).toBe(true);
    expect(await page.evaluate(() => (globalThis as never as { __atlasForm: { done(): boolean } }).__atlasForm.done())).toBe(false);
    await page.evaluate(() => (window as never as { __done(): void }).__done());
    expect(await page.evaluate(() => (globalThis as never as { __atlasForm: { done(): boolean } }).__atlasForm.done())).toBe(true);
  });
});
