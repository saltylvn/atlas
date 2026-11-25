import type { ReactNode } from "react";
import { CareerNav } from "@/components/Nav";

// Everything inside the Career tab: Good fits and the apply queues on the hub, then
// the Tracker, Target Roles and Setup. On a phone, a row of tabs at the top moves
// between them (the sidebar does it on a laptop).
export default function CareerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <CareerNav />
      {children}
    </div>
  );
}
