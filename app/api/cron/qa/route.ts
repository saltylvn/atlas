import type { NextRequest } from "next/server";
import { handleCron } from "@/lib/agents/cron";

// The QA Agent's weekly review of Atlas itself: Sunday evening, Mountain time (Monday
// 01:00 UTC). Rules only, a few database reads, no outside request. The handler checks
// the bearer token.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleCron(request, "qa");
}
