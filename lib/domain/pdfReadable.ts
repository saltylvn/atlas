// Can a job board read this resume PDF? (docs/design.md, 5.6.) Pure.
//
// A job board does not see the page; it reads the text stored inside the PDF, in the order
// the file stores it. Two things go wrong with a designed resume:
//   - there is no text at all (it was outlined or flattened to shapes), or lines are missing;
//   - the text is stored in another order than it reads, so sections come out mixed together.
// This compares the PDF's text with the resume as Atlas reads it from the Figma frame.
//
// It is a check of the file, not a promise about any one job board: some lay the page out
// again and read it correctly anyway. "Mixed order" is therefore a warning, never a stop.

import type { ResumeDoc } from "./resumeSync";
import type { PdfReading } from "./types";

/** Letters and digits only, lowercased: spacing, bullets and dashes differ between Figma and a PDF. */
const squash = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
const wordsOf = (s: string): string[] => s.normalize("NFKC").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** A line long enough that finding its start in the text places it without doubt. */
const KEY_CHARS = 24;
const MIN_KEY = 12;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export const NOT_CHECKED: PdfReading = { verdict: "unknown", pages: 0, lines: 0, found: 0, notes: ["Atlas could not read this PDF to check it. Open it and try selecting the text yourself."] };

/**
 * Compares a PDF's text with the resume lines read from Figma.
 * bad: little or no readable text. warn: lines missing, or stored in a mixed order. good: neither.
 */
export function readability(pdfText: string, pages: number, doc: ResumeDoc): PdfReading {
  const text = squash(pdfText);
  const have = new Set(wordsOf(pdfText));
  const lines = doc.lines.filter((l) => squash(l.text).length > 0);
  const total = squash(lines.map((l) => l.text).join(" ")).length;

  // Where each line starts in the PDF's text, by section. -1: not placed.
  let section = 0;
  const placed: { section: number; at: number; found: boolean; text: string }[] = [];
  for (const line of lines) {
    if (line.kind === "h2") section++;
    const full = squash(line.text);
    const key = full.slice(0, KEY_CHARS);
    const at = key.length >= MIN_KEY ? text.indexOf(key) : -1;
    // Atlas joins some lines itself (the skills, a school and its degree): those count as
    // found when their words are there, wherever each one sits.
    const words = wordsOf(line.text);
    const present = words.length ? words.filter((w) => have.has(w)).length / words.length : text.includes(full) ? 1 : 0;
    placed.push({ section, at, found: at >= 0 || present >= 0.8 || (key.length < MIN_KEY && text.includes(full)), text: line.text });
  }
  const found = placed.filter((p) => p.found).length;
  const base = { pages, lines: lines.length, found };

  if (lines.length === 0) return { ...NOT_CHECKED, pages };
  if (text.length < Math.max(150, total * 0.25) || found / lines.length < 0.6) {
    return { verdict: "bad", ...base, notes: ["A job board cannot read this PDF's text. In Figma, check that the text is live text, not outlined or flattened to shapes, then send a test again."] };
  }

  const notes: string[] = [];
  const missing = placed.filter((p) => !p.found);
  if (found / lines.length < 0.92) notes.push(`${missing.length} of ${lines.length} lines of your resume were not found in the PDF's text, starting with "${clip(missing[0]!.text, 60)}".`);

  // Order: inside a section the lines should come in the order they read, and one section
  // should not be cut into pieces by another.
  const sure = placed.filter((p) => p.at >= 0);
  let pairs = 0;
  let inOrder = 0;
  for (let n = 1; n < sure.length; n++) {
    if (sure[n]!.section !== sure[n - 1]!.section) continue;
    pairs++;
    if (sure[n]!.at > sure[n - 1]!.at) inOrder++;
  }
  const byPlace = [...sure].sort((a, b) => a.at - b.at);
  const switches = byPlace.filter((p, n) => n > 0 && p.section !== byPlace[n - 1]!.section).length;
  const sections = new Set(sure.map((p) => p.section)).size;
  const mixed = sections > 1 && switches > (sections - 1) * 2;
  if ((pairs >= 3 && inOrder / pairs < 0.8) || mixed) {
    notes.push("The text is stored in this PDF in a different order than it reads on the page, so a job board that reads it top to bottom may mix your sections together. See what a job board reads, below.");
  }

  if (pages > 1) notes.push(`The PDF has ${pages} pages.`);
  const warned = notes.some((n) => !n.startsWith("The PDF has"));
  if (!warned) notes.unshift(`A job board can read this PDF: ${found} of ${lines.length} lines found, in the order they read.`);
  return { verdict: warned ? "warn" : "good", ...base, notes };
}

/**
 * With nothing to compare against: is there text a job board can read at all? A resume has
 * well over a thousand letters; a PDF of shapes or an image has almost none.
 */
export function selectable(pdfText: string, pages: number): PdfReading {
  const chars = squash(pdfText).length;
  if (chars < 400) return { verdict: "bad", pages, lines: 0, found: 0, notes: ["A job board cannot read this PDF's text. Export it from Figma as a PDF with live text (not outlined or flattened), and put the new file in Notion."] };
  return { verdict: "good", pages, lines: 0, found: 0, notes: [`A job board can read this PDF: its text is selectable (${chars.toLocaleString("en-US")} letters and digits).`, ...(pages > 1 ? [`The PDF has ${pages} pages.`] : [])] };
}

/** How much of the PDF's text the test card shows. */
export const PREVIEW_CHARS = 2500;
