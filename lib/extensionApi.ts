import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { Context } from "@/lib/context";
import { demoStore } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { localDate, localTime } from "@/lib/domain/dates";
import { keyMatches } from "@/lib/domain/extensionForm";
import type { EXTENSION_ROUTES } from "@/lib/domain/refusedTokens";
import { mode } from "@/lib/env";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { noteRefusedToken } from "@/lib/security/refusedToken";
import { rateLimit } from "@/lib/security/rateLimit";

// The door Atlas Autofill comes in by. Its routes are outside the browser-session gate
// (lib/supabase/gate.ts) and check their own key instead: only the key's SHA-256 is stored,
// in your settings, and it is compared in constant time. The key can do only what these
// routes do: answer a form, hand over the role's resume, and save an answer you corrected.
// Every use is audited by the route; the key is never logged.

/** Extension pages call from these origins; nothing else gets CORS headers. */
const EXTENSION_ORIGIN = /^(chrome-extension|safari-web-extension|moz-extension):\/\/[A-Za-z0-9-]{1,80}$/;

export function cors(request: NextRequest, res: NextResponse): NextResponse {
  const origin = request.headers.get("origin") ?? "";
  if (EXTENSION_ORIGIN.test(origin)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Headers", "authorization, content-type");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const preflight = (request: NextRequest) => cors(request, new NextResponse(null, { status: 204 }));

const refuse = (request: NextRequest, status: number, error: string) => cors(request, NextResponse.json({ error }, { status }));

/**
 * The owner's context for a request that carries the extension's key, or a response to send
 * instead. Live: the owner-scoped service store, as the scheduled jobs use. Demo: the demo store.
 */
export async function extensionContext(request: NextRequest, route: (typeof EXTENSION_ROUTES)[number]): Promise<{ ctx: Context; persist: Store } | NextResponse> {
  if (!rateLimit("extension", 60, 10 * 60_000).allowed) return refuse(request, 429, "Too many requests from the extension. Try again in a few minutes.");
  const m = mode();
  let store: Store;
  if (m === "live") {
    if (!serviceReady()) return refuse(request, 503, "Atlas is not configured for the extension.");
    store = ownerServiceStore();
  } else if (m === "demo") store = demoStore();
  else return refuse(request, 503, "Atlas is not configured.");
  const settings = await store.settings.get();
  const header = request.headers.get("authorization");
  if (!keyMatches(header, settings.extensionKey)) {
    noteRefusedToken(route, header);
    return refuse(request, 401, settings.extensionKey ? "The extension's key is not the one Atlas has. Connect it again in Settings." : "The extension is not connected. Connect it in Atlas Settings.");
  }
  const now = new Date();
  const ctx: Context = { mode: m, userId: m === "live" ? (ownerUserId() ?? "") : "demo", store, settings, now, today: localDate(now, settings.timezone), time: localTime(now, settings.timezone) };
  // When it was last used, at most once a minute, so Settings can say so.
  const last = settings.extensionKey?.lastUsedAt;
  if (!last || now.getTime() - Date.parse(last) > 60_000) await store.settings.update({ extensionKey: { ...settings.extensionKey!, lastUsedAt: now.toISOString() } }).catch(() => undefined);
  return { ctx, persist: store };
}
