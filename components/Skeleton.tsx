// Server-rendered placeholders shown while a route or a slow section streams in.
// Pure markup: no client JS. The shimmer stops under prefers-reduced-motion.

export function Bone({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block rounded-md ${className}`} />;
}

export function CardSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card card-pad ${className}`} aria-hidden>
      <Bone className="mb-4 h-4 w-32" />
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Bone key={i} className={`h-3.5 ${i % 3 === 2 ? "w-2/3" : i % 2 ? "w-5/6" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-line overflow-hidden" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="px-4 py-3">
          <Bone className={`h-4 ${i % 2 ? "w-4/5" : "w-11/12"}`} />
          <Bone className="mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** Page frame: a title bar plus whatever body the route passes in. */
export function PageSkeleton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      <div>
        <Bone className="h-3 w-28" />
        <Bone className="mt-2 h-8 w-56 md:h-9" />
      </div>
      {children}
    </div>
  );
}
