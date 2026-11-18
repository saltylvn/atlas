import { Bone, CardSkeleton, PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="jobs">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card px-4 py-3">
            <Bone className="h-3 w-16" />
            <Bone className="mt-2 h-7 w-10" />
          </div>
        ))}
      </div>
      <CardSkeleton lines={5} />
      <CardSkeleton lines={4} />
    </PageSkeleton>
  );
}
