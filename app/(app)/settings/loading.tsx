import { CardSkeleton, PageSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="settings">
      <CardSkeleton lines={5} />
      <CardSkeleton lines={4} />
    </PageSkeleton>
  );
}
