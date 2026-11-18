"use client";

import "./globals.css";

// Last-resort boundary for errors in the root layout itself. Renders its own document.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center" role="alert">
          <h1 className="text-2xl font-semibold">Atlas could not load</h1>
          <p className="mt-2 max-w-sm text-sm text-ink-2">Check your connection and try again.</p>
          <button type="button" onClick={reset} className="btn btn-primary mt-6">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
