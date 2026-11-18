import { CardSkeleton, ListSkeleton, PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="news">
      <CardSkeleton lines={2} />
      <ListSkeleton rows={8} />
    </PageSkeleton>
  );
}
