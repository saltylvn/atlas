import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { googleClient, googleMissing, hasGmailScope, OAUTH_COOKIE, saveGoogleConnection, syncGmail } from "@/lib/connections/google";
import { getContext } from "@/lib/context";
import { exchangeCode, idTokenEmail } from "@/lib/integrations/google";
import { hasCalendarScopes } from "@/lib/integrations/googleCalendar";
import { saveCalendarConnection } from "@/lib/connections/googleCalendar";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";

// Step 2: Google sends the owner back here with a one-time code. Check state, swap the
// code (with the PKCE verifier) for tokens, keep only the refresh token, encrypted.

/** Constant-time compare. Lengths are compared in bytes, so odd input can never make it throw. */
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(request: NextRequest) {
  const ctx = await getContext();
  const [state, verifier, purpose] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  const calendar = purpose === "calendar";
  const done = (status: string) => {
    const res = NextResponse.redirect(new URL(`/connectors?${calendar ? "calendar" : "google"}=${status}`, request.url));
    res.cookies.set(OAUTH_COOKIE, "", { path: "/api/connect/google", maxAge: 0 });
    return res;
  };
  if (ctx.mode !== "live" || googleMissing().length > 0) return done("not_configured");
  assertSessionIsOwner(ctx);

  const params = request.nextUrl.searchParams;
  const fail = async (detail: string, status = "failed") => {
    await audit(ctx.store, { actor: "owner", action: calendar ? "connection.google_calendar.connect" : "connection.google.connect", target: calendar ? "google_calendar" : "google", detail, outcome: "denied" });
    return done(status);
  };

  if (params.get("error")) return fail("consent declined", "declined");
  const code = params.get("code") ?? "";
  if (!state || !verifier || !same(state, params.get("state") ?? "")) return fail("state mismatch");
  if (!/^[\w./-]{10,512}$/.test(code)) return fail("malformed code");

  try {
    const tokens = await exchangeCode(googleClient(), code, verifier);
    const email = idTokenEmail(tokens.id_token);
    if (!tokens.refresh_token || !email) return fail("no refresh token or email");
    if (calendar) {
      // Google Calendar: its own connection, read-only; Gmail is untouched.
      if (!hasCalendarScopes(tokens.scope ?? "")) return fail("calendar read scopes not granted", "scope");
      await saveCalendarConnection({ email, scopes: tokens.scope ?? "", refreshToken: tokens.refresh_token });
      await audit(ctx.store, { actor: "owner", action: "connection.google_calendar.connect", target: "google_calendar", detail: "calendarlist.readonly, events.readonly", outcome: "success" });
      return done("connected");
    }
    if (!hasGmailScope(tokens.scope ?? "")) return fail("gmail.readonly not granted", "scope");
    await saveGoogleConnection({ email, scopes: tokens.scope ?? "", refreshToken: tokens.refresh_token });
    await audit(ctx.store, { actor: "owner", action: "connection.google.connect", target: "google", detail: "gmail.readonly", outcome: "success" });
  } catch {
    return fail("token exchange failed");
  }

  // First sync right away, so the inbox is populated when the page loads.
  await syncGmail(ownerServiceStore()).catch(() => undefined);
  return done("connected");
}
