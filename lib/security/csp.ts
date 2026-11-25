// Content Security Policy, built per request with a fresh nonce (sent by proxy.ts).
// Only scripts carrying the nonce run, so injected markup cannot execute code.
// The browser talks only to this origin: Supabase, Claude, feeds and job boards are
// all reached from the server.

export function buildCsp(options: { nonce: string; isDev: boolean; supabaseUrl?: string; /** True only for a file Atlas shows inside its own page (the resume PDF viewer). */ framedBySelf?: boolean }): string {
  const { nonce, isDev } = options;
  let supabaseOrigin = "";
  try {
    if (options.supabaseUrl) supabaseOrigin = new URL(options.supabaseUrl).origin;
  } catch {
    // a malformed URL is simply left out
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (progress bars, status colors) need this; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    // data: covers the TOTP enrollment QR code Supabase returns as an SVG data URL.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    // Google sign-in: a server action redirects to Supabase, which redirects to Google.
    `form-action 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""} https://accounts.google.com`,
    // No other site may ever frame Atlas. Its own resume viewer frames the resume PDF, and only that.
    options.framedBySelf ? "frame-ancestors 'self'" : "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
