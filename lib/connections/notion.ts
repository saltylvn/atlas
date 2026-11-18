import "server-only";
import type { Store } from "@/lib/data/store";
import { explainNotion, notionRolesPatch } from "@/lib/domain/notionRoles";
import type { NotionSync, Settings } from "@/lib/domain/types";
import { diagnoseNotion, identityLine, NOTION_HELP, NotionError, notionConfigured, notionIdentity, notionWorkspace, readNotionRoles } from "@/lib/integrations/notion";

// Syncing from Notion. Notion's Resumes database decides the order of your target roles
// and supplies each role's resume; Atlas copies both into Settings, where the Career
// Agent, Target roles and the Approval Queue already read them. So nothing waits on
// Notion at page load, and a Notion outage leaves the last good copy in place.
// This sync only reads. Atlas writes to Notion in two other places, both named in
// lib/integrations/notion.ts: the resume sync's own block, and a role order you approved.

export interface NotionSyncResult {
  settings: Settings;
  sync: NotionSync;
  /** True when the role order or a resume link changed. */
  changed: boolean;
}

/** How long a sync stays fresh for the automatic refresh on Target roles. */
export const NOTION_FRESH_MS = 10 * 60_000;

export const notionIsStale = (settings: Pick<Settings, "notion">, now: Date) => !settings.notion || now.getTime() - Date.parse(settings.notion.at) > NOTION_FRESH_MS;

/**
 * Reads the Resumes database and updates Settings. Never throws: a failure is recorded
 * in `settings.notion` and the stored roles and links are left as they were. Returns
 * null when Notion is not set up.
 */
export async function syncNotion(store: Store, settings: Settings, now: Date): Promise<NotionSyncResult | null> {
  if (!notionConfigured()) return null;
  const at = now.toISOString();
  const previous = settings.notion;
  try {
    const [workspace, read] = await Promise.all([notionWorkspace(), readNotionRoles(settings.notionResumesId)]);
    const patch = notionRolesPatch(read.roles, settings);
    if (!patch) {
      const sync: NotionSync = { at, ok: false, workspace, roles: 0, resumes: 0, message: "The Resumes database has no roles. Add a row per role with a Priority number." };
      return { settings: await store.settings.update({ notion: sync, notionResumesId: read.dataSourceId }), sync, changed: false };
    }
    // The Master Resume counts as a resume, never as a role.
    const master = read.master || settings.careerMasterResume || "";
    const sync: NotionSync = { at, ok: true, workspace, roles: patch.careerRoles.length, resumes: patch.resumes + (read.master ? 1 : 0), master: Boolean(read.master), message: "" };
    const changed = patch.changed || master !== (settings.careerMasterResume ?? "");
    return { settings: await store.settings.update({ careerRoles: patch.careerRoles, careerResumes: patch.careerResumes, careerMasterResume: master, notion: sync, notionResumesId: read.dataSourceId }), sync, changed };
  } catch (err) {
    let message = err instanceof NotionError ? err.message : NOTION_HELP.unavailable;
    let sees: string[] | undefined;
    // "Refused" has several causes with different fixes. Ask Notion what the connection
    // can actually see, and say exactly which one it is.
    if (err instanceof NotionError && (err.problem === "forbidden" || err.problem === "not_found")) {
      const [d, id] = await Promise.all([diagnoseNotion(settings.notionResumesId).catch(() => null), notionIdentity()]);
      if (d) {
        message = explainNotion(d);
        sees = d.sees;
        // When the connection sees nothing, the most useful fact is which connection it is.
        if (d.total === 0) message = `${message} ${identityLine(id)}`;
      }
    }
    const sync: NotionSync = { at, ok: false, workspace: previous?.workspace ?? "", roles: previous?.roles ?? 0, resumes: previous?.resumes ?? 0, message, ...(sees ? { sees } : {}) };
    const saved = await store.settings.update({ notion: sync }).catch(() => ({ ...settings, notion: sync }));
    return { settings: saved, sync, changed: false };
  }
}
