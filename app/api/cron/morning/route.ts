import type { NextRequest } from "next/server";
import { handleCron } from "@/lib/agents/cron";

// Morning Brief (weekdays) or the lighter Saturday Brief. Sunday is off.
// The Hobby plan's limit with Fluid compute; SCHEDULED_LIMIT_MS in lib/domain/deadline.ts matches it.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleCron(request, "morning");
}
