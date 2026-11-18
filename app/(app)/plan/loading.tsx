import { Bone, CardSkeleton, PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="plan">
      <div className="card card-pad flex gap-2" aria-hidden>
        <Bone className="h-[42px] flex-1 rounded-[10px]" />
        <Bone className="h-[42px] w-20 rounded-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <CardSkeleton lines={6} className="lg:col-span-2" />
        <CardSkeleton lines={4} />
      </div>
    </PageSkeleton>
  );
}
