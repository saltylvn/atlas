import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_OPTIONS } from "./cookies";
import { CONSENT_COOKIE, isAuthorizationId } from "@/lib/mcp/auth";
import { decide, isPublicPath, type Claims } from "./gate";

/**
 * Refreshes the Supabase session cookie and gates every non-public path:
 * signed out -> /login, wrong account -> signed out with an error, no 2nd factor -> /mfa.
 * MFA is not optional in live mode: the database policies also require aal2.
 * The data-access layer (lib/context.ts) repeats the check; this is the outer wall.
 */
export async function gateRequest(request: NextRequest, extraHeaders: Record<string, string>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const forwarded = () => {
    const headers = new Headers(request.headers);
    Object.entries(extraHeaders).forEach(([k, v]) => headers.set(k, v));
    return { headers };
  };
  let response = NextResponse.next({ request: forwarded() });

  const supabase = createServerClient(url, key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: forwarded() });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // getClaims verifies the JWT signature; do not put code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as Claims | null;
  const path = request.nextUrl.pathname;

  // The setup page is for a deployment with no database. This one has one.
  if (path === "/setup") return redirect(request, response, "/");

  if (isPublicPath(path)) {
    if (path === "/login" && claims) {
      const d = decide(claims, process.env.ATLAS_OWNER_EMAIL, true, path);
      if (d === "allow") return redirect(request, response, "/");
    }
    return response;
  }

  const decision = decide(claims, process.env.ATLAS_OWNER_EMAIL, true, path);
  // Connecting Claude: remember which consent request to come back to after sign-in and MFA.
  const consentId = path === "/oauth/consent" ? request.nextUrl.searchParams.get("authorization_id") : null;
  if ((decision === "login" || decision === "mfa") && isAuthorizationId(consentId)) response.cookies.set(CONSENT_COOKIE, consentId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 15 * 60 });
  switch (decision) {
    case "allow":
      return response;
    case "login":
      return path.startsWith("/api/") ? deny(401) : redirect(request, response, "/login");
    case "mfa":
      return path.startsWith("/api/") ? deny(401) : redirect(request, response, "/mfa");
    case "forbidden":
      await supabase.auth.signOut();
      return path.startsWith("/api/") ? deny(403) : redirect(request, response, "/login?error=not_owner");
  }
}

function deny(status: number) {
  return NextResponse.json({ error: status === 401 ? "unauthenticated" : "forbidden" }, { status });
}

function redirect(request: NextRequest, from: NextResponse, path: string) {
  const res = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  res.headers.set("cache-control", "private, no-store");
  return res;
}
