import { AppShell } from "../components/layout/app-shell.js";
import { ProfilePanel } from "../components/domain/auth/profile-panel.js";
import { getViewer } from "../lib/server/api.js";

export const metadata = {
  title: "Profile - BurstFlare",
  description: "Manage workspace settings, billing, and active browser sessions."
};

export default async function ProfilePage() {
  const viewer = await getViewer();
  return (
    <AppShell active="profile">
      <ProfilePanel initialViewer={viewer} />
    </AppShell>
  );
}
