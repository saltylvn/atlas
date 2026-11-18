import type { NextRequest } from "next/server";
import { handleSync } from "@/lib/agents/sync";

// The 2-hour sync: Monday to Saturday, 6 AM to 4 PM Mountain time. Called once in each
// candidate hour; the handler checks the bearer token and the local hour.
// The Hobby plan's limit with Fluid compute; SCHEDULED_LIMIT_MS in lib/domain/deadline.ts matches it.
export const maxDuration = 300;

export function GET(request: NextRequest) {
  return handleSync(request);
}
