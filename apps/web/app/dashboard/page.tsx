import { DashboardPanel } from "../components/domain/dashboard/dashboard-panel.js";
import { AppShell } from "../components/layout/app-shell.js";
import { getDashboardSnapshot } from "../lib/server/api.js";

export const metadata = {
  title: "Dashboard - BurstFlare",
  description: "Manage instances, sessions, common state, and usage-based billing visibility."
};

export default async function DashboardPage() {
  const initialSnapshot = await getDashboardSnapshot();

  return (
    <AppShell active="dashboard">
      <DashboardPanel initialSnapshot={initialSnapshot} />
    </AppShell>
  );
}
