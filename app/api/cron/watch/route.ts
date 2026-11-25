import type { NextRequest } from "next/server";
import { handleWatch } from "@/lib/agents/watch";

// The 15-minute watch (docs/design-pipeline.md, 5.8): inbox headers, job mail, timeline
// events, one push. Called by Supabase Cron every 15 minutes with its own bearer secret,
// which can run this and nothing else (docs/WATCH.md). POST: it changes data.
// A quiet run takes a few seconds; the limit leaves room for a slow Gmail.
export const maxDuration = 60;

export function POST(request: NextRequest) {
  return handleWatch(request);
}
