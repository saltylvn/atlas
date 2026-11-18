import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { env, mode, type Mode } from "@/lib/env";
import { localDate, localTime } from "@/lib/domain/dates";
import type { Settings } from "@/lib/domain/types";
import { demoStore } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { createSupabaseStore } from "@/lib/data/supabase";
import { createUserClient } from "@/lib/supabase/server";
import { decide, type Claims } from "@/lib/supabase/gate";

export interface Context {
  mode: Exclude<Mode, "misconfigured">;
  /** The signed-in owner's user id (live), or "demo". */
  userId: string;
  store: Store;
  settings: Settings;
  now: Date;
  today: string;
  time: string;
  /**
   * When this request will be stopped (epoch ms), set by scheduled and manual runs. Model
   * calls inside the run wait only for the time left (`modelWait`), so the run can always
   * save its work. Unset: each call keeps its own cap.
   */
  deadline?: number;
  /** A scheduled run nobody is waiting on: model calls may wait longer (`aiCap`). */
  patient?: boolean;
}

/**
 * The data-access layer's front door. Every page and server action calls this.
 * It re-checks the owner + MFA rule from proxy.ts (defense in depth: a matcher
 * mistake in the proxy must not expose data) and returns a store scoped to the owner.
 * cache() makes it once per request.
 */
export const getContext = cache(async (): Promise<Context> => {
  // Personal data: always render per request, never prerender at build time.
  await connection();
  const m = mode();
  if (m === "misconfigured") redirect("/setup");

  let store: Store;
  let userId = "demo";
  if (m === "live") {
    const db = await createUserClient();
    const { data } = await db.auth.getClaims();
    const e = env();
    const decision = decide((data?.claims ?? null) as Claims | null, e.ATLAS_OWNER_EMAIL, true, "");
    if (decision !== "allow") redirect(decision === "mfa" ? "/mfa" : "/login");
    userId = String((data?.claims as { sub?: string } | undefined)?.sub ?? "");
    store = createSupabaseStore(db);
  } else {
    store = demoStore();
  }

  const settings = await store.settings.get();
  const now = new Date();
  return {
    mode: m,
    userId,
    store,
    settings,
    now,
    today: localDate(now, settings.timezone),
    time: localTime(now, settings.timezone),
  };
});
