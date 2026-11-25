// Resume sync, the pure part: Figma is where the resumes are designed, Notion is where
// Atlas reads them. Once a day the Applications Agent reads each resume's frame in Figma
// and, when its text changed, mirrors the text into that role's page in Notion, inside one
// block that Atlas owns. Ask Atlas then indexes it like any other resume text.
//
// Nothing here does I/O. This file turns a Figma frame into resume text, decides whether
// a page needs writing, and builds the Notion block. Figma's and Notion's text is data:
// it is trimmed, length-limited and never executed or rendered as markup.

import { weekdayIndex } from "./dates";
import type { LocalDate } from "./types";
import { hashPassage } from "./knowledge";

// ---------------------------------------------------------------------------
// Where a row's resume lives in Figma: the link in the row's Notes.

export interface FigmaRef {
  fileKey: string;
  /** "201:2" */
  nodeId: string;
}

const FIGMA_LINK = /https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([0-9A-Za-z]{22,64})\/[^\s?)\]]*\?[^\s)\]]*?node-id=(\d{1,7})[-:](\d{1,7})/;

/** The first Figma frame link in a piece of text, or null. Only figma.com design links with a node id count. */
export function figmaRef(text: string): FigmaRef | null {
  const m = FIGMA_LINK.exec(text.slice(0, 4000));
  return m ? { fileKey: m[1]!, nodeId: `${m[2]}:${m[3]}` } : null;
}

// ---------------------------------------------------------------------------
// A Figma frame as resume text.

/** The parts of a Figma REST node this file reads. */
export interface FigmaNode {
  type?: string;
  name?: string;
  visible?: boolean;
  characters?: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  style?: { fontSize?: number; fontWeight?: number };
}

export type ResumeLine = { kind: "h2" | "h3" | "p" | "li"; text: string };

export interface ResumeDoc {
  lines: ResumeLine[];
}

interface Placed {
  x: number;
  y: number;
  size: number;
  weight: number;
  text: string;
}

const MAX_LINE = 1900;
/** Notion takes 100 blocks in one request; the container is one of them. */
export const MAX_LINES = 96;

const clean = (s: string) => s.replace(/[\s\u00a0\u2028\u2029]+/g, " ").trim();
const BULLET = /^[\u2022\u00b7\u25e6\u25aa\-\u2013\u2014*]$/;
/** Contact details never leave Figma: an email address, a phone number, or a profile link. */
const CONTACT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|github)\.com\/\S+/i;

function placedText(frame: FigmaNode): { width: number; texts: Placed[] } {
  const origin = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
  const texts: Placed[] = [];
  const walk = (n: FigmaNode, depth: number) => {
    if (!n || typeof n !== "object" || n.visible === false || depth > 24) return;
    if (n.type === "TEXT" && typeof n.characters === "string" && n.absoluteBoundingBox) {
      const text = clean(n.characters).slice(0, MAX_LINE);
      if (text && !BULLET.test(text)) {
        texts.push({
          x: n.absoluteBoundingBox.x - origin.x,
          y: n.absoluteBoundingBox.y - origin.y,
          size: typeof n.style?.fontSize === "number" ? n.style.fontSize : 0,
          weight: typeof n.style?.fontWeight === "number" ? n.style.fontWeight : 0,
          text,
        });
      }
    }
    if (Array.isArray(n.children)) for (const c of n.children.slice(0, 400)) walk(c, depth + 1);
  };
  walk(frame, 0);
  return { width: origin.width, texts: texts.slice(0, 600) };
}

/** The most common font size, weighted by how much text is set in it: the body size. */
function bodySize(texts: Placed[]): number {
  const by = new Map<number, number>();
  for (const t of texts) if (t.size > 0) by.set(t.size, (by.get(t.size) ?? 0) + t.text.length);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

interface Section {
  title: string;
  lines: ResumeLine[];
}

const byPosition = (a: Placed, b: Placed) => a.y - b.y || a.x - b.x;
const is = (title: string, name: string) => title.trim().toLowerCase() === name;

/**
 * Reads a resume frame by where its text sits and how big it is, not by layer names, so
 * renaming or regrouping layers in Figma does not break it:
 *   - the page has a narrow left column (contact, skills, education, certifications) and
 *     a main column (summary, experience, projects);
 *   - the biggest text is the name; text clearly larger than the body is a section title;
 *     text a little larger than the body is an entry title; indented body text is a bullet.
 * The Contact section is left out. Returns null when the frame holds no usable text.
 */
export function resumeFromFigma(frame: FigmaNode): ResumeDoc | null {
  const { width, texts } = placedText(frame);
  const body = bodySize(texts);
  if (!body || width <= 0 || texts.length < 8) return null;
  const sectionAt = body * 1.45;
  const titleAt = body * 1.08;
  const nameAt = body * 3;

  const main = texts.filter((t) => t.x >= width * 0.3 && t.size < nameAt).sort(byPosition);
  const side = texts.filter((t) => t.x < width * 0.3 && t.size < nameAt).sort(byPosition);
  if (main.length === 0) return null;
  const mainLeft = Math.min(...main.map((t) => t.x));

  const mainSections: Section[] = [];
  for (const t of main) {
    const isSummaryLabel = t.size >= titleAt && is(t.text, "summary");
    if (t.size >= sectionAt || isSummaryLabel) {
      mainSections.push({ title: t.text, lines: [] });
      continue;
    }
    const current = mainSections.at(-1);
    if (!current) continue;
    if (t.size >= titleAt) current.lines.push({ kind: "h3", text: t.text });
    else current.lines.push({ kind: t.x > mainLeft + 6 ? "li" : "p", text: t.text });
  }

  const sideSections: Section[] = [];
  let raw: { title: string; items: Placed[] } | null = null;
  const closeSide = () => {
    if (!raw || is(raw.title, "contact")) return;
    const items = raw.items.filter((i) => !CONTACT.test(i.text));
    if (items.length === 0) return;
    if (is(raw.title, "skills")) {
      sideSections.push({ title: raw.title, lines: [{ kind: "p", text: items.map((i) => i.text).join(", ").slice(0, MAX_LINE) }] });
      return;
    }
    // An entry starts on a heavier line (the school) and takes the lighter lines under it.
    const weights = new Set(items.map((i) => i.weight));
    const heavy = Math.max(...weights);
    if (weights.size > 1 && heavy >= 600) {
      const entries: string[][] = [];
      for (const i of items) {
        if (i.weight >= heavy || entries.length === 0) entries.push([i.text]);
        else entries.at(-1)!.push(i.text);
      }
      sideSections.push({ title: raw.title, lines: entries.map((e) => ({ kind: "li" as const, text: (e.length > 1 ? `${e[0]}: ${e.slice(1).join(", ")}` : e[0]!).slice(0, MAX_LINE) })) });
      return;
    }
    sideSections.push({ title: raw.title, lines: items.map((i) => ({ kind: "li" as const, text: i.text })) });
  };
  for (const t of side) {
    if (t.size >= sectionAt) {
      closeSide();
      raw = { title: t.text, items: [] };
    } else if (raw) raw.items.push(t);
  }
  closeSide();

  // Reading order: summary, skills, the rest of the main column, the rest of the sidebar.
  const summary = mainSections.filter((s) => is(s.title, "summary"));
  const skills = sideSections.filter((s) => is(s.title, "skills"));
  const ordered = [...summary, ...skills, ...mainSections.filter((s) => !summary.includes(s)), ...sideSections.filter((s) => !skills.includes(s))];
  const lines: ResumeLine[] = [];
  for (const s of ordered) {
    const kept = s.lines.filter((l) => !CONTACT.test(l.text));
    if (kept.length === 0) continue;
    lines.push({ kind: "h2", text: s.title.slice(0, 120) }, ...kept);
  }
  return lines.length ? { lines: lines.slice(0, MAX_LINES) } : null;
}

/**
 * Whether the text read from Figma looks like a whole resume. A frame that reads as a
 * fragment (a renamed page, a half-built layout) is never written over good text.
 */
export function looksLikeResume(doc: ResumeDoc | null): doc is ResumeDoc {
  if (!doc) return false;
  const sections = doc.lines.filter((l) => l.kind === "h2").map((l) => l.text.toLowerCase());
  const chars = doc.lines.reduce((n, l) => n + l.text.length, 0);
  return sections.length >= 3 && sections.includes("summary") && doc.lines.some((l) => l.kind === "li") && chars >= 600;
}

/**
 * The doc as Atlas reads it back from Notion (`blocksToText`): one line per block, a
 * heading closed with a full stop. The two must agree, or every page would look edited.
 */
export function docText(doc: ResumeDoc): string {
  return doc.lines.map((l) => (l.kind === "h2" || l.kind === "h3" ? `${l.text}.` : l.text)).join("\n");
}

/** A short fingerprint of resume text. Not a secret: it only tells "same" from "changed". */
export const fingerprint = (text: string): string => hashPassage("resume", text.replace(/[ \t]+/g, " ").trim(), "", null).slice(0, 12);

// ---------------------------------------------------------------------------
// The block Atlas owns on each resume page.

export const MIRROR_PREFIX = "Resume text, mirrored from Figma by Atlas";

/** The container's first line: what it is, when it was written, and the two fingerprints. */
export function mirrorLabel(day: string, figmaPrint: string, bodyPrint: string): string {
  return `${MIRROR_PREFIX} on ${day}. Edits here are replaced when the Figma resume changes. Ref f:${figmaPrint} b:${bodyPrint}.`;
}

export const isMirrorLabel = (text: string): boolean => text.trim().startsWith(MIRROR_PREFIX);

/** The fingerprints in a container's label, or null when it carries none (written by hand). */
export function parseMirrorLabel(text: string): { figmaPrint: string; bodyPrint: string } | null {
  if (!isMirrorLabel(text)) return null;
  const m = /Ref f:([0-9a-f]{12}) b:([0-9a-f]{12})\.?\s*$/.exec(text.trim());
  return m ? { figmaPrint: m[1]!, bodyPrint: m[2]! } : null;
}

/** Resume text without the container's label line, for the search index. */
export const withoutMirrorLabel = (text: string): string =>
  text
    .split("\n")
    .filter((l) => !isMirrorLabel(l))
    .join("\n");

const rich = (content: string) => [{ type: "text", text: { content: content.slice(0, MAX_LINE) } }];
const BLOCK = { h2: "heading_2", h3: "heading_3", p: "paragraph", li: "bulleted_list_item" } as const;

/** The Notion block to append: one callout holding the resume as headings, paragraphs and bullets. */
export function mirrorBlock(doc: ResumeDoc, day: string): Record<string, unknown> {
  const print = fingerprint(docText(doc));
  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: rich(mirrorLabel(day, print, print)),
      icon: { type: "emoji", emoji: "📄" },
      color: "gray_background",
      children: doc.lines.slice(0, MAX_LINES).map((l) => ({ object: "block", type: BLOCK[l.kind], [BLOCK[l.kind]]: { rich_text: rich(l.text) } })),
    },
  };
}

// ---------------------------------------------------------------------------
// The decision for one page.

export interface MirrorState {
  /** The label's fingerprints, or null when the container has no label Atlas wrote. */
  label: { figmaPrint: string; bodyPrint: string } | null;
  /** Fingerprint of the text in the container right now. */
  bodyPrint: string;
}

export type SyncDecision =
  /** No container yet, or one Atlas did not stamp: write it. */
  | "write"
  /** Figma has not changed and nobody touched the page. */
  | "same"
  /** You edited the text in Notion and Figma has not changed since: your edit stands. */
  | "kept"
  /** You edited the text in Notion and Figma changed too: Atlas will not choose for you. */
  | "conflict";

/**
 * What to do with one resume page. Atlas only ever replaces its own container, and never
 * one whose text no longer matches what it wrote.
 */
export function decideSync(figmaPrint: string, mirror: MirrorState | null): SyncDecision {
  if (!mirror || !mirror.label) return "write";
  const edited = mirror.bodyPrint !== mirror.label.bodyPrint;
  const figmaChanged = mirror.label.figmaPrint !== figmaPrint;
  if (edited) return figmaChanged ? "conflict" : "kept";
  return figmaChanged ? "write" : "same";
}

// ---------------------------------------------------------------------------
// The run, as a sentence.

export interface ResumeSyncReport {
  /** Roles whose Notion page was rewritten from Figma. */
  updated: string[];
  unchanged: number;
  /** Edited in Notion, Figma unchanged: left alone. */
  kept: string[];
  /** Edited in Notion and changed in Figma: left alone, needs you. */
  conflicts: string[];
  /** The Figma frame did not read as a whole resume. */
  unreadable: string[];
  /** Rows with no Figma link in their Notes. */
  unlinked: string[];
  /** Pages not reached before the time limit; they go first next run. */
  waiting: string[];
}

export const emptyReport = (): ResumeSyncReport => ({ updated: [], unchanged: 0, kept: [], conflicts: [], unreadable: [], unlinked: [], waiting: [] });

const names = (xs: string[]) => (xs.length <= 3 ? xs.join(", ") : `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more`);

export function syncSummary(r: ResumeSyncReport): string {
  const parts: string[] = [];
  if (r.updated.length) parts.push(`${r.updated.length} updated from Figma (${names(r.updated)})`);
  if (r.unchanged) parts.push(`${r.unchanged} unchanged`);
  if (r.kept.length) parts.push(`${r.kept.length} kept as edited in Notion (${names(r.kept)})`);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} changed in both Figma and Notion, not overwritten (${names(r.conflicts)})`);
  if (r.unreadable.length) parts.push(`${r.unreadable.length} Figma frame${r.unreadable.length === 1 ? "" : "s"} did not read as a resume (${names(r.unreadable)})`);
  if (r.unlinked.length) parts.push(`${r.unlinked.length} with no Figma link in Notes (${names(r.unlinked)})`);
  if (r.waiting.length) parts.push(`${r.waiting.length} left for the next run`);
  return parts.length ? `Resumes: ${parts.join("; ")}.` : "Resumes: nothing to sync.";
}

/** True when the run found something you need to look at. */
export const needsYou = (r: ResumeSyncReport): boolean => r.conflicts.length > 0 || r.unreadable.length > 0;

// ---------------------------------------------------------------------------
// The weekly schedule

/** The resume update runs once a week, on Monday (weekdayIndex 0). */
export const isResumeSyncDay = (day: LocalDate): boolean => weekdayIndex(day) === 0;

/** What Atlas tells you each Monday about the weekly resume update. `report` is null when it could not run. */
export function weeklyResumeNotice(report: ResumeSyncReport | null, why = ""): { title: string; body: string; url: string } {
  const url = "/roles#resume-sync";
  if (!report) return { title: "Weekly resume update did not run", body: (why || "Figma or Notion could not be read.").slice(0, 200), url };
  const n = report.updated.length;
  if (needsYou(report)) return { title: "Weekly resume update needs a look", body: "A resume changed in both Figma and Notion, or a frame could not be read.", url };
  if (n > 0) return { title: `Weekly resume update: ${n} resume${n === 1 ? "" : "s"} updated in Notion`, body: "The new text is in Notion and Ask Atlas. Export the PDF from Figma and put it in that row's Resume file: applications send that file.", url };
  return { title: "Weekly resume update: no changes", body: "Your resumes in Notion already match Figma.", url };
}
