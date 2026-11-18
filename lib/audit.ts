import "server-only";
import type { Store } from "@/lib/data/store";
import type { AuditEvent } from "@/lib/domain/types";

/**
 * Records a security-relevant event. A failed audit write is logged loudly but does
 * not break the user's action; the console line is the backup trail (Vercel logs).
 * Details must never contain secrets or message bodies. Resolves to whether the row was
 * written, for the one caller that keeps a count to try again with (refused tokens).
 */
export async function audit(store: Store, event: Omit<AuditEvent, "id" | "at">): Promise<boolean> {
  try {
    await store.audit.append({ ...event, detail: event.detail.slice(0, 300) });
    return true;
  } catch (err) {
    console.error("[audit] write failed", event.action, event.outcome, (err as Error).message);
    return false;
  }
}
