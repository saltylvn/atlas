import { NextResponse } from "next/server";
import { mode } from "@/lib/env";

// Liveness only. Reveals the mode, never configuration details.
export function GET() {
  return NextResponse.json({ ok: true, mode: mode() }, { headers: { "cache-control": "no-store" } });
}
