import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { gateRequest } from "@/lib/supabase/proxy";

// Next.js 16 "proxy" (formerly middleware): the network edge of the app.
// 1. A fresh CSP nonce on every request.
// 2. Live mode: session refresh + owner/MFA gate (lib/supabase/proxy.ts).
// 3. Demo mode: no gate, fictional data only.
// 4. Production with no database and no explicit demo flag: fail closed to /setup.
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const isDev = process.env.NODE_ENV === "development";
  // The resume PDFs are the one thing Atlas shows inside a frame, on its own viewer page.
  const framedBySelf = request.nextUrl.pathname.startsWith("/api/apply/");
  const csp = buildCsp({ nonce, isDev, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, framedBySelf });
  const headers = { "x-nonce": nonce, "Content-Security-Policy": csp };

  const live = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      process.env.ATLAS_OWNER_EMAIL,
  );
  const demoAllowed = process.env.NODE_ENV !== "production" || ["1", "true"].includes(process.env.ATLAS_DEMO ?? "");

  let response: NextResponse;
  if (live) {
    response = await gateRequest(request, headers);
  } else if (demoAllowed) {
    const forwarded = new Headers(request.headers);
    Object.entries(headers).forEach(([k, v]) => forwarded.set(k, v));
    response = NextResponse.next({ request: { headers: forwarded } });
  } else if (request.nextUrl.pathname === "/setup" || request.nextUrl.pathname === "/api/health") {
    response = NextResponse.next();
  } else {
    response = request.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ error: "not configured" }, { status: 503 })
      : NextResponse.redirect(new URL("/setup", request.url));
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
