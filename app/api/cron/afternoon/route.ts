import type { NextRequest } from "next/server";
import { handleCron } from "@/lib/agents/cron";

// 2:00 PM Brief, weekdays only: fresh email, calendar and only stories new since the morning.
// The Hobby plan's limit with Fluid compute; SCHEDULED_LIMIT_MS in lib/domain/deadline.ts matches it.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleCron(request, "afternoon");
}
