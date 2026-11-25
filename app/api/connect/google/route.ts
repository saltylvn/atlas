import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { googleClient, googleMissing, OAUTH_COOKIE } from "@/lib/connections/google";
import { getContext } from "@/lib/context";
import { env } from "@/lib/env";
import { authorizeUrl, GMAIL_SCOPE, pkcePair } from "@/lib/integrations/google";
import { CALENDAR_SCOPES } from "@/lib/integrations/googleCalendar";
import { assertSessionIsOwner } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";

// Step 1 of connecting Gmail (or, with ?for=calendar, Google Calendar): send the signed-in
// owner to Google's consent screen, asking only for that connection's read-only scopes.
// state (CSRF) and the PKCE verifier ride in a short-lived, httpOnly cookie scoped to
// this route, and are checked by the callback.

export async function GET(request: Request) {
  const ctx = await getContext();
  const back = (status: string) => NextResponse.redirect(new URL(`/connectors?google=${status}`, request.url));
  if (ctx.mode !== "live") return back("demo");
  if (googleMissing().length > 0) return back("not_configured");
  assertSessionIsOwner(ctx);
  if (!rateLimit("google-connect", 10, 15 * 60_000).allowed) return back("rate_limited");

  const purpose = new URL(request.url).searchParams.get("for") === "calendar" ? "calendar" : "gmail";
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  await audit(ctx.store, { actor: "owner", action: "connection.google.start", target: purpose === "calendar" ? "google_calendar" : "google", detail: "", outcome: "success" });

  const response = NextResponse.redirect(authorizeUrl(googleClient(), state, challenge, env().ATLAS_OWNER_EMAIL, purpose === "calendar" ? CALENDAR_SCOPES : [GMAIL_SCOPE]));
  response.cookies.set(OAUTH_COOKIE, `${state}.${verifier}.${purpose}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/connect/google",
    maxAge: 600,
  });
  return response;
}
