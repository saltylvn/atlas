import Link from "next/link";
import { AppMark } from "@/components/AppMark";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="overflow-hidden rounded-[12px]">
        <AppMark size={48} />
      </span>
      <h1 className="h-display mt-5 text-2xl font-semibold">Nothing here</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-2">That page does not exist or has moved.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Back to Today
      </Link>
    </main>
  );
}
