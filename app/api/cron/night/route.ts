import type { NextRequest } from "next/server";
import { handleCron } from "@/lib/agents/cron";

// The night shift: while you sleep, the Researcher and Tailor agents prepare today's top
// picks (lib/agents/nightShift.ts). Called several times around 10 to 11 PM Mountain time, in
// the UTC hours for both sides of daylight saving; the handler checks the bearer token and the
// local hour, and each call carries on from where the last one stopped.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleCron(request, "night");
}
