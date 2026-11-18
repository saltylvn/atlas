import "server-only";
import type { Store } from "@/lib/data/store";
import type { AuditEvent } from "@/lib/domain/types";

/**
 * Records a security-relevant event. A failed audit write is logged loudly but does
 * not break the user's action; the console line is the backup trail (Vercel logs).
 * Details must never contain secrets or message bodies.
 */
export async function audit(store: Store, event: Omit<AuditEvent, "id" | "at">): Promise<void> {
  try {
    await store.audit.append({ ...event, detail: event.detail.slice(0, 300) });
  } catch (err) {
    console.error("[audit] write failed", event.action, event.outcome, (err as Error).message);
  }
}
