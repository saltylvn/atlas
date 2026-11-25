import type { NextRequest } from "next/server";
import { handleCron } from "@/lib/agents/cron";

// The evening run: the Applications Agent's resume sync (Figma to Notion), then the
// Career Mentor's evening review. Monday to Saturday, about 6 PM Mountain time. Called in
// two candidate UTC hours (daylight saving moves it); the handler checks the bearer
// token and the local hour, and runs once.
// The Hobby plan's limit with Fluid compute; SCHEDULED_LIMIT_MS in lib/domain/deadline.ts matches it.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleCron(request, "evening");
}
