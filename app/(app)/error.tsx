"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// Catches a failure in any tab. The header, tab bar and quick-capture stay usable,
// so one broken section never strands you. No error details are shown or sent:
// the digest is an opaque id that matches the server log.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="card card-pad mx-auto max-w-lg text-center" role="alert">
      <h1 ref={heading} tabIndex={-1} className="h-display text-xl font-semibold outline-none">
        This tab hit a snag
      </h1>
      <p className="mt-2 text-sm text-ink-2">Your data is safe. Try again, or head back to Today.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">Ref {error.digest}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Go to Today
        </Link>
      </div>
    </section>
  );
}
