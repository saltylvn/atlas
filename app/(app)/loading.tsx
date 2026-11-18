import { Bone, CardSkeleton, PageSkeleton } from "@/components/Skeleton";

// Today: the shell paints instantly while weather, news and the calendar load.
export default function Loading() {
  return (
    <PageSkeleton label="today">
      <div className="card card-pad md:p-7" aria-hidden>
        <Bone className="h-3 w-40" />
        <Bone className="mt-3 h-6 w-4/5" />
        <Bone className="mt-4 h-3.5 w-full" />
        <Bone className="mt-2 h-3.5 w-11/12" />
        <Bone className="mt-2 h-3.5 w-2/3" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <CardSkeleton lines={4} className="lg:col-span-2" />
        <CardSkeleton lines={3} />
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} className="md:col-span-2 lg:col-span-1" />
      </div>
    </PageSkeleton>
  );
}
