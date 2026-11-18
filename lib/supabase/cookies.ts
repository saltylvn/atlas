// Options for the Supabase session cookies, shared by proxy.ts and the server client.
//
// Atlas never runs a Supabase client in the browser: every read and write goes through
// the server. So the session cookies are HttpOnly (page scripts cannot read the access or
// refresh token, even if a script were ever injected), Secure in production (never sent
// over plain http), and SameSite=Lax (not sent on cross-site POSTs).
export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};
