import { DashboardShell } from "@/components/app/dashboard-shell";
import { BusinessSection } from "./business-section";

export default function BusinessPage() {
  return (
    <DashboardShell active="business">
      <BusinessSection />
    </DashboardShell>
  );
}
