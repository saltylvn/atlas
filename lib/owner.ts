import "server-only";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { createSupabaseStore } from "@/lib/data/supabase";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

// Work that needs the secret key (stored tokens, inbox writes, scheduled jobs) runs as
// the owner through these helpers, and only ever for ATLAS_OWNER_USER_ID.

export function ownerUserId(): string | null {
  return env().ATLAS_OWNER_USER_ID ?? null;
}

/** True when the secret-key path is configured. */
export function serviceReady(): boolean {
  const e = env();
  return Boolean(e.SUPABASE_SECRET_KEY && e.ATLAS_OWNER_USER_ID && e.NEXT_PUBLIC_SUPABASE_URL);
}

/** A store scoped to the owner on the secret-key client. Server-side jobs only. */
export function ownerServiceStore(): Store {
  const id = ownerUserId();
  if (!id || !serviceReady()) throw new Error("Owner service access is not configured");
  return createSupabaseStore(createServiceClient(), id);
}

/**
 * Before a signed-in request uses the secret key, confirm the session belongs to the
 * configured owner id (the email was already checked by getContext).
 */
export function assertSessionIsOwner(ctx: Context): void {
  if (ctx.mode !== "live" || !ctx.userId || ctx.userId !== ownerUserId()) {
    throw new Error("This session is not the configured owner");
  }
}

/**
 * The store that may create and move apply rows and keep resume files. Live, that is the
 * secret-key store, used only after the session is confirmed to be the owner's; in the demo
 * it is the in-memory store.
 */
export function ownerWriteStore(ctx: Context): Store {
  if (ctx.mode !== "live") return ctx.store;
  assertSessionIsOwner(ctx);
  return ownerServiceStore();
}
