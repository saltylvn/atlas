import "server-only";
import { masterResumeFromNotion, rolesFromNotion, visibleItems, type NotionDiagnosis, type NotionOutcome, type NotionRole, blocksToText, nestedBlockIds, resumePagesFromNotion, resumeSourcesFromNotion, type ResumeFile } from "@/lib/domain/notionRoles";
import { fingerprint, isMirrorLabel, parseMirrorLabel, withoutMirrorLabel, type FigmaRef, type MirrorState } from "@/lib/domain/resumeSync";
import { env } from "@/lib/env";
import { HttpError, safeFetchBytes, safeFetchJson } from "@/lib/security/safeFetch";

// Notion. Atlas reads one thing: the Resumes database in Atlas HQ (your target roles in
// priority order, with each role's resume). The token is an internal Notion integration
// secret kept in Vercel (NOTION_TOKEN), and the integration sees only the pages you share
// with it, so Atlas cannot see the rest of the workspace.
//
// It writes two things, and only when the connection has "Insert content" and "Update
// content":
//   1. The resume sync keeps one block on each resume row's page, a callout that mirrors
//      the resume's text from Figma (lib/domain/resumeSync.ts). Atlas appends that block
//      and deletes its own older copy.
//   2. When you approve the Career Mentor's proposed role order (and only then), Atlas sets the
//      Priority number on the role rows, and adds a row for a role you approved adding
//      (lib/domain/roleOutlook.ts, app/actions/roles.ts).
// It never edits any other property, block or page, and never deletes a row. With "Read
// content" only, both report that they may not write and everything else works as before.
//
// Every call goes through safeFetch (https, allowlisted host api.notion.com, timeout,
// size cap). The token is never logged, echoed in an error, or sent to the browser.

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";
const RESUMES_TITLE = "resumes";

export type NotionProblem = "not_configured" | "bad_token" | "forbidden" | "not_found" | "bad_request" | "rate_limited" | "unavailable";

export class NotionError extends Error {
  constructor(readonly problem: NotionProblem) {
    super(NOTION_HELP[problem]);
  }
}

/** What to tell the owner. Fixed text: nothing from Notion's reply is echoed. */
export const NOTION_HELP: Record<NotionProblem, string> = {
  not_configured: "Notion is not set up yet: add NOTION_TOKEN in Vercel.",
  bad_token: "Notion rejected the token. Copy the integration's secret again and update NOTION_TOKEN in Vercel.",
  forbidden: "Notion refused: the Atlas connection is missing a permission. In its settings, under Capabilities, tick Read content.",
  not_found: "Atlas can't see the Resumes database. In Notion, open the Resumes database, click ••• > Connections, and add Atlas.",
  bad_request: "Notion rejected the format of Atlas's request. That is a bug in Atlas, not your setup: tell Claude.",
  rate_limited: "Notion is rate-limiting requests. Try again in a minute.",
  unavailable: "Notion could not be reached. Try again in a few minutes.",
};

export const notionConfigured = () => Boolean(env().NOTION_TOKEN);

async function call<T>(path: string, body?: unknown, method?: "PATCH" | "DELETE"): Promise<T> {
  const token = env().NOTION_TOKEN;
  if (!token) throw new NotionError("not_configured");
  try {
    return await safeFetchJson<T>(`${API}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { authorization: `Bearer ${token}`, "notion-version": VERSION, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      timeoutMs: 6000,
      maxBytes: 1_000_000,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) throw new NotionError("bad_token");
      // Notion answers 403 when the connection lacks a capability, and 404 when the page or
      // database is not shared with it (or does not exist). They need different fixes.
      if (err.status === 403) throw new NotionError("forbidden");
      if (err.status === 404) throw new NotionError("not_found");
      if (err.status === 400) throw new NotionError("bad_request");
      if (err.status === 429) throw new NotionError("rate_limited");
    }
    // Timeouts, 5xx and malformed replies. The original message is not passed on.
    throw new NotionError("unavailable");
  }
}

const plain = (title: unknown): string =>
  Array.isArray(title) ? title.map((t) => (t && typeof t === "object" && typeof (t as { plain_text?: unknown }).plain_text === "string" ? (t as { plain_text: string }).plain_text : "")).join("") : "";

/**
 * The workspace the token belongs to, for the Connectors card. Only a label: a connection
 * created with "No user information" may not be allowed to ask, and that must never stop
 * a sync. A rejected token is still reported, since nothing else will work either.
 */
export async function notionWorkspace(): Promise<string> {
  try {
    const me = await call<{ bot?: { workspace_name?: unknown } }>("/users/me");
    const name = me?.bot?.workspace_name;
    return typeof name === "string" ? name.slice(0, 80) : "";
  } catch (err) {
    if (err instanceof NotionError && err.problem === "bad_token") throw err;
    return "";
  }
}

export interface NotionIdentity {
  /** The connection's name in Notion, e.g. "Atlas". "" when Notion would not say. */
  name: string;
  workspace: string;
  /** internal: a developer connection (what Atlas expects); personal: a personal access token. */
  kind: "internal" | "personal" | "unknown";
}

const clipText = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/**
 * Which Notion connection the token in Vercel belongs to: its name, workspace and kind.
 * Shown after a refused sync, so a token from the wrong connection is obvious. Never throws.
 */
export async function notionIdentity(): Promise<NotionIdentity | null> {
  try {
    const me = await call<{ name?: unknown; bot?: { workspace_name?: unknown; owner?: { type?: unknown } } }>("/users/me");
    const owner = me?.bot?.owner?.type;
    return { name: clipText(me?.name, 60), workspace: clipText(me?.bot?.workspace_name, 60), kind: owner === "workspace" ? "internal" : owner === "user" ? "personal" : "unknown" };
  } catch {
    return null;
  }
}

/** One sentence naming the connection behind the token, for the refused-sync message. */
export function identityLine(id: NotionIdentity | null): string {
  if (!id) return "Atlas could not ask Notion which connection the token belongs to.";
  const who = id.name ? `“${id.name}”` : "an unnamed connection";
  const where = id.workspace ? ` in the workspace “${id.workspace}”` : "";
  const kind = id.kind === "personal" ? " It is a personal token, not a developer connection: create a developer connection and use its secret." : "";
  return `The token in Vercel belongs to ${who}${where}.${kind} If that is not the connection you shared Atlas HQ with, copy the secret from the right one.`;
}

const ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Finds the shared database titled "Resumes" with Notion's search. Search lags behind
 * sharing and restoring by minutes, so it is only the fallback: a known id is read
 * directly. Only ids of the expected shape are accepted.
 */
async function searchResumesDataSourceId(): Promise<string> {
  const found = await call<{ results?: unknown }>("/search", { query: "Resumes", filter: { property: "object", value: "data_source" }, page_size: 20 });
  const hits = Array.isArray(found?.results) ? found.results : [];
  const match = hits.find((h) => h && typeof h === "object" && (h as { object?: unknown }).object === "data_source" && plain((h as { title?: unknown }).title).trim().toLowerCase() === RESUMES_TITLE) as
    | { id?: unknown }
    | undefined;
  const id = typeof match?.id === "string" ? match.id : "";
  if (!ID.test(id)) throw new NotionError("not_found");
  return id;
}

const queryRoles = async (id: string) => {
  const results = (await call<{ results?: unknown }>(`/data_sources/${encodeURIComponent(id)}/query`, { page_size: 50 }))?.results;
  return { roles: rolesFromNotion(results), master: masterResumeFromNotion(results) };
};

export interface NotionRolesRead {
  roles: NotionRole[];
  /** The Master Resume row's link, or "" when there is none. */
  master: string;
  /** The Resumes data source that answered, remembered for the next sync. */
  dataSourceId: string;
}

/**
 * Your target roles from the Resumes database, in priority order. The database is read
 * directly by id: NOTION_RESUMES_DATA_SOURCE_ID when set, else the id remembered from
 * the last sync. If that id is gone (the database was replaced) or there is none yet,
 * Atlas looks for the shared database titled "Resumes".
 */
export async function readNotionRoles(knownId?: string): Promise<NotionRolesRead> {
  const fixed = env().NOTION_RESUMES_DATA_SOURCE_ID;
  if (fixed) return { ...(await queryRoles(fixed)), dataSourceId: fixed };
  if (knownId && ID.test(knownId)) {
    try {
      return { ...(await queryRoles(knownId)), dataSourceId: knownId };
    } catch (err) {
      if (!(err instanceof NotionError) || (err.problem !== "not_found" && err.problem !== "forbidden")) throw err;
    }
  }
  const id = await searchResumesDataSourceId();
  return { ...(await queryRoles(id)), dataSourceId: id };
}

const outcomeOf = (err: unknown): NotionOutcome => {
  const p = err instanceof NotionError ? err.problem : "unavailable";
  return p === "forbidden" || p === "not_found" || p === "bad_request" ? p : "error";
};

/**
 * After a refused sync: ask Notion what the connection can see at all, and try the
 * Resumes database once more by its id, so the owner is told the exact cause. Two
 * read-only requests. Never throws.
 */
export async function diagnoseNotion(knownId?: string): Promise<NotionDiagnosis> {
  const id = env().NOTION_RESUMES_DATA_SOURCE_ID ?? (knownId && ID.test(knownId) ? knownId : undefined);
  const [seen, direct] = await Promise.all([
    call<{ results?: unknown }>("/search", { page_size: 25 }).then(
      (r) => ({ search: "ok" as NotionOutcome, ...visibleItems(r?.results) }),
      (err) => ({ search: outcomeOf(err), sees: [] as string[], total: 0, hasResumes: false }),
    ),
    id ? queryRoles(id).then(() => "ok" as NotionOutcome, outcomeOf) : Promise.resolve("skipped" as NotionOutcome),
  ]);
  return { ...seen, direct };
}

export interface ResumeText {
  /** The row's name: a target role, or "Master Resume". */
  role: string;
  text: string;
}

const children = (id: string) => call<{ results?: unknown }>(`/blocks/${encodeURIComponent(id)}/children?page_size=100`);

/**
 * The text of each resume row's page in the Resumes database, for Ask Atlas. Read-only.
 * A row whose page is empty is left out. Requests run one after another, since Notion
 * allows about three a second. Throws NotionError like every other read.
 */
export async function readResumeTexts(knownId?: string): Promise<ResumeText[]> {
  const fixed = env().NOTION_RESUMES_DATA_SOURCE_ID;
  const id = fixed || (knownId && ID.test(knownId) ? knownId : "") || (await searchResumesDataSourceId());
  const rows = (await call<{ results?: unknown }>(`/data_sources/${encodeURIComponent(id)}/query`, { page_size: 50 }))?.results;
  const out: ResumeText[] = [];
  for (const page of resumePagesFromNotion(rows)) {
    const top = (await children(page.pageId))?.results;
    const parts = [blocksToText(top)];
    for (const nested of nestedBlockIds(top)) {
      const inner = (await children(nested))?.results;
      parts.push(blocksToText(inner));
      // One more level: a column list holds columns, which hold the text.
      for (const deeper of nestedBlockIds(inner, 4)) parts.push(blocksToText((await children(deeper))?.results));
    }
    // The label on the block Atlas mirrors from Figma is not part of the resume.
    const text = withoutMirrorLabel(parts.filter(Boolean).join("\n")).trim();
    if (text) out.push({ role: page.name, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The resume sync's reads and its one write.

export interface ResumeSource {
  /** The row's name: a target role, or "Master Resume". */
  role: string;
  pageId: string;
  /** The Figma frame linked in the row's Notes, or null. */
  figma: FigmaRef | null;
  /** The PDF in the row's Resume file column, or null. */
  file: ResumeFile | null;
}

/** Each resume row with its page and its Figma frame. Read-only. */
export async function readResumeSources(knownId?: string): Promise<ResumeSource[]> {
  const fixed = env().NOTION_RESUMES_DATA_SOURCE_ID;
  const id = fixed || (knownId && ID.test(knownId) ? knownId : "") || (await searchResumesDataSourceId());
  const rows = (await call<{ results?: unknown }>(`/data_sources/${encodeURIComponent(id)}/query`, { page_size: 50 }))?.results;
  return resumeSourcesFromNotion(rows).map((r) => ({ role: r.name, pageId: r.pageId, figma: r.figma, file: r.file }));
}

/** Where Notion keeps uploaded files. On the allowlist; a link to any other host is refused. */
export const NOTION_FILE_HOST = "prod-files-secure.s3.us-west-2.amazonaws.com";
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/**
 * The resume PDF from a row's Resume file column. Notion's link is signed and short-lived, so
 * it carries no token of ours and is read fresh each time. Checked to be a PDF. Read-only.
 */
export async function downloadResumeFile(file: ResumeFile): Promise<Uint8Array> {
  let host = "";
  try {
    host = new URL(file.url).hostname;
  } catch {
    host = "";
  }
  if (host !== NOTION_FILE_HOST) throw new NotionError("not_found");
  const bytes = await safeFetchBytes(file.url, { accept: "application/pdf", timeoutMs: 30_000, maxBytes: MAX_RESUME_BYTES, revalidate: 0 }).catch(() => {
    throw new NotionError("unavailable");
  });
  if (bytes.length < 100 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new NotionError("bad_request");
  return bytes;
}

export interface PageMirror {
  /** Block ids of the containers Atlas owns on this page, oldest first. Normally none or one. */
  blockIds: string[];
  /** The newest container's state, or null when the page has none. */
  state: MirrorState | null;
}

const BLOCK_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** The containers Atlas owns on a resume page, and what the newest one holds. Read-only. */
export async function readPageMirror(pageId: string): Promise<PageMirror> {
  const top = (await children(pageId))?.results;
  const mine: { id: string; label: string }[] = [];
  if (Array.isArray(top)) {
    for (const b of top) {
      if (!b || typeof b !== "object") continue;
      const o = b as { id?: unknown; type?: unknown; callout?: { rich_text?: unknown } };
      if (o.type !== "callout" || typeof o.id !== "string" || !BLOCK_ID.test(o.id)) continue;
      const label = plain(o.callout?.rich_text);
      if (isMirrorLabel(label)) mine.push({ id: o.id, label });
    }
  }
  const newest = mine.at(-1);
  if (!newest) return { blockIds: [], state: null };
  const body = blocksToText((await children(newest.id))?.results);
  return { blockIds: mine.map((m) => m.id), state: { label: parseMirrorLabel(newest.label), bodyPrint: fingerprint(body) } };
}

/**
 * Replaces Atlas's container on a resume page: the new block is appended first, then the
 * older copies are deleted, so a failure part-way never leaves the page without its text.
 * With no new block it only deletes the copies named (leftovers of a delete that failed).
 * Only ids that readPageMirror returned are ever passed here. Needs "Insert content" and
 * "Update content"; without them Notion answers 403 (NotionError "forbidden").
 */
export async function writePageMirror(pageId: string, block: Record<string, unknown> | null, replaces: readonly string[]): Promise<void> {
  if (!BLOCK_ID.test(pageId)) throw new NotionError("bad_request");
  if (block) await call(`/blocks/${encodeURIComponent(pageId)}/children`, { children: [block] }, "PATCH");
  for (const id of replaces.filter((r) => BLOCK_ID.test(r)).slice(0, 6)) await call(`/blocks/${encodeURIComponent(id)}`, undefined, "DELETE");
}

/** What to tell the owner when Notion refuses the sync's write. */
export const NOTION_WRITE_HELP = "Notion refused the write. In the Atlas connection's settings, under Capabilities, tick Insert content and Update content, then run the sync again.";
