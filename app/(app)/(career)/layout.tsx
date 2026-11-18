import type { ReactNode } from "react";
import { CareerNav } from "@/components/Nav";

// Everything inside the Career tab: the Approval Queue and today's picks on the hub, then
// Target roles, Applications and Job watchlist. On a phone, a row of tabs at the top moves
// between them (the sidebar does it on a laptop).
export default function CareerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <CareerNav />
      {children}
    </div>
  );
}
