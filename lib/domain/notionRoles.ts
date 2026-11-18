// Notion as the source of truth for your target roles. Pure: the integration
// (lib/integrations/notion.ts) fetches the Resumes database from Atlas HQ and this file
// turns its rows into the role order and resume links Atlas already keeps in Settings.
//
// A row is a role: its title, a Priority number (1 = first), an optional Share link, and
// an optional attached resume file. Notion's text is treated as data: names are trimmed
// and length-limited, links must be https, and nothing here is ever executed or rendered
// as markup.

import { figmaRef, type FigmaRef } from "./resumeSync";
import { rolesFrom } from "./targetRoles";
import type { Settings } from "./types";

export interface NotionRole {
  /** The role as named in Notion, without notes in brackets: "Forward Deployed Engineer". */
  name: string;
  /** 1 = first. Rows without a number sort last, in Notion's order. */
  priority: number | null;
  /** The resume's share link (e.g. Google Drive), or "". */
  shareLink: string;
  /** The row's own page in Notion, where an attached resume file lives. */
  pageUrl: string;
  /** True when a resume file is attached to the row. */
  hasFile: boolean;
  /** The row's page id in Notion, or "" when it is not a well-formed id. Its page body holds the resume's text. */
  pageId: string;
}

const PAGE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export const MAX_ROLES = 12;

/**
 * Rows that are a resume but not a role to hunt for: the Master Resume sits first in the
 * sheet as the copy the others are tailored from. It never becomes a target role.
 */
const NOT_A_ROLE = /^(master|general|base)\b/i;

const text = (v: unknown): string =>
  Array.isArray(v)
    ? v
        .map((t) => (t && typeof t === "object" && typeof (t as { plain_text?: unknown }).plain_text === "string" ? (t as { plain_text: string }).plain_text : ""))
        .join("")
    : "";

/** Only plain https links, with no username or password, are kept. */
export function httpsLink(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 600) return "";
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Rich text as plain text, followed by the targets of its links (a link's label need not be its address). */
const linkedText = (v: unknown): string =>
  Array.isArray(v)
    ? `${text(v)} ${v.map((t) => (t && typeof t === "object" && typeof (t as { href?: unknown }).href === "string" ? (t as { href: string }).href : "")).join(" ")}`.slice(0, 4000)
    : "";

type Props = Record<string, { type?: string; [k: string]: unknown }>;

/** The first property of a type, preferring one with the expected name. */
function prop(props: Props, type: string, preferred: string): { [k: string]: unknown } | undefined {
  const named = props[preferred];
  if (named?.type === type) return named;
  return Object.values(props).find((p) => p?.type === type);
}

/** Rows of the Resumes database (a Notion query response's `results`) as roles, in priority order. */
function parseRows(results: unknown): (NotionRole & { master: boolean; notes: string })[] {
  if (!Array.isArray(results)) return [];
  const rows: (NotionRole & { master: boolean; notes: string })[] = [];
  for (const page of results) {
    if (!page || typeof page !== "object") continue;
    const p = page as { id?: unknown; properties?: Props; url?: unknown; in_trash?: unknown; archived?: unknown };
    if (p.in_trash === true || p.archived === true || !p.properties) continue;
    const name = text(prop(p.properties, "title", "Role")?.title)
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!name) continue;
    const n = prop(p.properties, "number", "Priority")?.number;
    const files = prop(p.properties, "files", "Resume file")?.files;
    rows.push({
      name,
      priority: typeof n === "number" && Number.isFinite(n) ? n : null,
      shareLink: httpsLink(prop(p.properties, "url", "Share link")?.url),
      pageUrl: httpsLink(p.url),
      hasFile: Array.isArray(files) && files.length > 0,
      pageId: typeof p.id === "string" && PAGE_ID.test(p.id) ? p.id : "",
      master: NOT_A_ROLE.test(name),
      notes: linkedText(prop(p.properties, "rich_text", "Notes")?.rich_text),
    });
  }
  return rows;
}

/** A row's resume: its Share link, else the row's own page when a file is attached. */
const resumeLink = (r: Pick<NotionRole, "shareLink" | "hasFile" | "pageUrl">) => r.shareLink || (r.hasFile ? r.pageUrl : "");

/**
 * The Master Resume row's link, or "". The master is the copy the role resumes are
 * tailored from: Atlas keeps its link, and never treats it as a role.
 */
export function masterResumeFromNotion(results: unknown): string {
  const m = parseRows(results).find((r) => r.master);
  return m ? resumeLink(m) : "";
}

export function rolesFromNotion(results: unknown): NotionRole[] {
  const seen = new Set<string>();
  return parseRows(results)
    .filter((r) => !r.master)
    .map(({ master: _master, notes: _notes, ...r }) => r)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.priority ?? Infinity) - (b.r.priority ?? Infinity) || a.i - b.i)
    .map(({ r }) => r)
    .filter((r) => {
      const k = r.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_ROLES);
}

export interface NotionRolesPatch {
  careerRoles: string[];
  careerResumes: Record<string, string>;
  /** How many roles have a resume from Notion (a share link or an attached file). */
  resumes: number;
  /** True when the order or a link differs from what Settings held. */
  changed: boolean;
}

/**
 * What Settings should hold after a sync. Notion decides the role order. A resume link
 * from Notion (its Share link, else the row's page when a file is attached) replaces the
 * stored one; a role with nothing in Notion keeps the link you pasted in Atlas.
 */
export function notionRolesPatch(rows: NotionRole[], current: Pick<Settings, "careerRoles" | "careerResumes">): NotionRolesPatch | null {
  if (rows.length === 0) return null;
  // Built-in roles keep their canonical names ("FDE" and "Forward Deployed Engineer" are one role).
  const roles = rolesFrom(rows.map((r) => r.name));
  const careerRoles = [...new Set(roles.map((r) => r.name))];
  const careerResumes = { ...(current.careerResumes ?? {}) };
  let resumes = 0;
  rows.forEach((row, i) => {
    const link = resumeLink(row);
    if (!link) return;
    careerResumes[roles[i]!.name] = link;
    resumes++;
  });
  const before = JSON.stringify([current.careerRoles ?? [], current.careerResumes ?? {}]);
  return { careerRoles, careerResumes, resumes, changed: before !== JSON.stringify([careerRoles, careerResumes]) };
}

// ---------------------------------------------------------------------------
// When a sync is refused: work out exactly why, and say what to do about it.

/** How one request to Notion ended. */
export type NotionOutcome = "ok" | "forbidden" | "not_found" | "bad_request" | "error" | "skipped";

export interface NotionDiagnosis {
  /** Asking Notion what the connection can see at all. */
  search: NotionOutcome;
  /** Titles of the first few things it can see. */
  sees: string[];
  /** How many things it can see (first page of results). */
  total: number;
  /** A database titled "Resumes" is among them. */
  hasResumes: boolean;
  /** Reading the Resumes database directly by its remembered id. */
  direct: NotionOutcome;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a Notion search response shows the connection can see. Titles are clipped plain text. */
export function visibleItems(results: unknown): Pick<NotionDiagnosis, "sees" | "total" | "hasResumes"> {
  if (!Array.isArray(results)) return { sees: [], total: 0, hasResumes: false };
  const items: { title: string; row: boolean; database: boolean }[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const o = r as { object?: unknown; title?: unknown; properties?: Props; parent?: { type?: unknown } };
    const database = o.object === "data_source" || o.object === "database";
    const title = (database ? text(o.title) : text(o.properties ? prop(o.properties, "title", "title")?.title : undefined)).replace(/\s+/g, " ").trim();
    // A row of a database is a page too; list the pages and databases themselves first.
    const row = !database && (o.parent?.type === "data_source_id" || o.parent?.type === "database_id");
    items.push({ title: clip(title || "(untitled)", 40), row, database });
  }
  const ordered = [...items].sort((a, b) => Number(a.row) - Number(b.row) || Number(b.database) - Number(a.database));
  return {
    sees: [...new Set(ordered.map((i) => i.title))].slice(0, 6),
    total: items.length,
    hasResumes: items.some((i) => i.database && i.title.trim().toLowerCase() === "resumes"),
  };
}

/** One plain sentence or two: what is wrong, and the exact fix. Fixed text plus the titles above. */
export function explainNotion(d: NotionDiagnosis): string {
  const READ_CONTENT = "In Notion, open the Atlas connection's settings and, under Capabilities, tick Read content. Then sync again.";
  if (d.search === "bad_request" || d.direct === "bad_request") return "Notion rejected the format of Atlas's request. That is a bug in Atlas, not your setup: tell Claude.";
  if (d.search === "forbidden") return `Notion accepted the token, but the Atlas connection is not allowed to read content. ${READ_CONTENT}`;
  if (d.search === "error") return "Notion accepted the token, but Atlas could not check what the connection can see. Try again in a few minutes.";
  if (d.total === 0) {
    return "Notion accepted the token, but the Atlas connection cannot see any page yet. In Notion, open Atlas HQ, click ••• > Connections, and add Atlas. If Atlas is already listed there, the token in Vercel belongs to a different connection or workspace: copy the secret again from the Atlas connection.";
  }
  const seen = `The Atlas connection can see ${d.total} item${d.total === 1 ? "" : "s"} (${d.sees.join(", ")})`;
  if (!d.hasResumes) return `${seen}, but not the Resumes database. In Notion, open the Resumes database itself, click ••• > Connections, and add Atlas.`;
  if (d.direct === "forbidden") return `${seen}, including Resumes, but may not read its rows. ${READ_CONTENT}`;
  return `${seen}, including Resumes, but reading its rows failed. Sync again; if it repeats, tell Claude.`;
}

/** Every resume row with a readable page: the Master Resume first, then roles in sheet order. */
export function resumePagesFromNotion(results: unknown): { name: string; pageId: string }[] {
  const rows = parseRows(results).filter((r) => r.pageId);
  return [...rows.filter((r) => r.master), ...rows.filter((r) => !r.master)].slice(0, MAX_ROLES + 1).map((r) => ({ name: r.name, pageId: r.pageId }));
}

export interface NotionRoleRows {
  /** The names of the title and Priority properties, as this database spells them. */
  titleProp: string;
  priorityProp: string;
  /** Every row, the Master Resume included, in Notion's order. */
  rows: { pageId: string; name: string; priority: number | null; master: boolean }[];
}

/** The name of the first property of a type, preferring the expected one. */
function propName(props: Props, type: string, preferred: string): string {
  if (props[preferred]?.type === type) return preferred;
  return Object.entries(props).find(([, p]) => p?.type === type)?.[0] ?? "";
}

/** The Resumes rows as the role-order writer needs them. Null when the database has no title or number column. */
export function roleRowsFromNotion(results: unknown): NotionRoleRows | null {
  if (!Array.isArray(results)) return null;
  const first = results.find((p): p is { properties: Props } => Boolean(p) && typeof p === "object" && Boolean((p as { properties?: unknown }).properties));
  if (!first) return null;
  const titleProp = propName(first.properties, "title", "Role");
  const priorityProp = propName(first.properties, "number", "Priority");
  if (!titleProp || !priorityProp) return null;
  return { titleProp, priorityProp, rows: parseRows(results).filter((r) => r.pageId).map((r) => ({ pageId: r.pageId, name: r.name, priority: r.priority, master: r.master })) };
}

/** Where each resume row's design lives: the first Figma frame link in its Notes, or null. */
export function resumeSourcesFromNotion(results: unknown): { name: string; pageId: string; figma: FigmaRef | null }[] {
  const rows = parseRows(results).filter((r) => r.pageId);
  return [...rows.filter((r) => r.master), ...rows.filter((r) => !r.master)].slice(0, MAX_ROLES + 1).map((r) => ({ name: r.name, pageId: r.pageId, figma: figmaRef(r.notes) }));
}

export const MAX_RESUME_CHARS = 12_000;

/**
 * The text of a Notion page's blocks (a "list block children" response's `results`), one
 * line per block. Only text is read: files, embeds and links' targets are ignored.
 */
export function blocksToText(results: unknown): string {
  if (!Array.isArray(results)) return "";
  const lines: string[] = [];
  for (const b of results) {
    if (!b || typeof b !== "object") continue;
    const type = (b as { type?: unknown }).type;
    if (typeof type !== "string") continue;
    const body = (b as Record<string, unknown>)[type];
    const line = text((body as { rich_text?: unknown } | undefined)?.rich_text).replace(/\s+/g, " ").trim();
    if (line) lines.push(/^heading_/.test(type) ? `${line}.` : line);
  }
  return lines.join("\n").slice(0, MAX_RESUME_CHARS);
}

/** Ids of blocks that hold more blocks (columns, toggles, lists), so a two-column resume is read whole. */
export function nestedBlockIds(results: unknown, max = 8): string[] {
  if (!Array.isArray(results)) return [];
  return results
    .filter((b): b is { id: string; has_children: true } => Boolean(b) && typeof b === "object" && (b as { has_children?: unknown }).has_children === true && typeof (b as { id?: unknown }).id === "string" && PAGE_ID.test((b as { id: string }).id))
    .map((b) => b.id)
    .slice(0, max);
}
