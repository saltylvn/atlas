import { redirect } from "next/navigation";
import { APPROVALS_HREF } from "@/components/ApprovalQueue";

// The apply queues live at the top of Career. Old links and bookmarks land there.
export default function ApprovalsPage() {
  redirect(APPROVALS_HREF);
}
