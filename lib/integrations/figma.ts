import "server-only";
import type { FigmaNode } from "@/lib/domain/resumeSync";
import { env } from "@/lib/env";
import { HttpError, safeFetchJson } from "@/lib/security/safeFetch";

// Figma, read-only. Atlas reads one thing: the text of the resume frames that the Notion
// Resumes database links to. The token is a personal access token with the single scope
// "File content: read", kept in Vercel (FIGMA_TOKEN). Figma's REST API cannot change a
// file's contents at all, so nothing here could edit a design even by mistake.
//
// Every call goes through safeFetch (https, allowlisted host api.figma.com, timeout, size
// cap). The token is never logged, echoed in an error, or sent to the browser.

const API = "https://api.figma.com/v1";
const FILE_KEY = /^[0-9A-Za-z]{22,64}$/;
const NODE_ID = /^\d{1,7}:\d{1,7}$/;
/** Frames per request: a resume frame is a few hundred KB of JSON. */
const MAX_FRAMES = 12;

export type FigmaProblem = "not_configured" | "bad_token" | "not_found" | "rate_limited" | "unavailable";

/** What to tell the owner. Fixed text: nothing from Figma's reply is echoed. */
export const FIGMA_HELP: Record<FigmaProblem, string> = {
  not_configured: "Figma is not set up yet: add FIGMA_TOKEN in Vercel, then redeploy.",
  bad_token: "Figma refused the token. Check that the token's File content scope is Read-only (not No access) and that it has not expired (90 days at most). If in doubt, generate a new one, update FIGMA_TOKEN in Vercel and redeploy.",
  not_found: "Figma could not find the resume file. Check the Figma link in the Notes of the Resumes rows, and that the token's account can open the file.",
  rate_limited: "Figma is rate-limiting requests. The next run will try again.",
  unavailable: "Figma could not be reached. The next run will try again.",
};

export class FigmaError extends Error {
  constructor(readonly problem: FigmaProblem) {
    super(FIGMA_HELP[problem]);
  }
}

/**
 * The token as Figma expects it. A value pasted into Vercel can carry a line break, a
 * space or quote marks around it; Figma then refuses it as if it were wrong. A Figma
 * token never contains whitespace or quotes, so they are removed.
 */
export const cleanFigmaToken = (raw: string | undefined): string => (raw ?? "").replace(/[\s"'`]+/g, "");

export const figmaConfigured = () => cleanFigmaToken(env().FIGMA_TOKEN).length >= 20;

/**
 * The given frames of one file, by node id. A frame Figma does not return (deleted, or
 * the id is wrong) is null. Ids and the file key are checked before they reach the URL.
 */
export async function readFigmaFrames(fileKey: string, nodeIds: readonly string[]): Promise<Record<string, FigmaNode | null>> {
  const token = cleanFigmaToken(env().FIGMA_TOKEN);
  if (token.length < 20) throw new FigmaError("not_configured");
  const ids = [...new Set(nodeIds)].filter((id) => NODE_ID.test(id)).slice(0, MAX_FRAMES);
  if (!FILE_KEY.test(fileKey) || ids.length === 0) throw new FigmaError("not_found");
  try {
    const res = await safeFetchJson<{ nodes?: Record<string, { document?: FigmaNode } | null> }>(`${API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids.join(","))}`, {
      headers: { "x-figma-token": token },
      timeoutMs: 15_000,
      maxBytes: 8_000_000,
    });
    const out: Record<string, FigmaNode | null> = {};
    for (const id of ids) out[id] = res?.nodes?.[id]?.document ?? null;
    return out;
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) throw new FigmaError("bad_token");
      if (err.status === 404) throw new FigmaError("not_found");
      if (err.status === 429) throw new FigmaError("rate_limited");
    }
    throw new FigmaError("unavailable");
  }
}
