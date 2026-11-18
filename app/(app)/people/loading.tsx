import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="people">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ListSkeleton rows={6} />
        </div>
        <CardSkeleton lines={5} />
      </div>
    </PageSkeleton>
  );
}
