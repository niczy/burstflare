import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Profile & workspace — BurstFlare",
  description: "Manage your workspace, team members, device approvals, and auth sessions.",
};

const turnstileKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

export default function ProfilePage() {
  const appScript = getAppScript(turnstileKey);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="profile" />

        {/* Identity bar */}
        <div className="card profile-identity-bar">
          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div className="row">
            <a href="/login" className="secondary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", padding: "12px 16px", borderRadius: "17px", border: "1px solid var(--line)", background: "rgba(255,255,255,0.8)", fontSize: "0.88rem", fontWeight: 700, color: "var(--ink)" }}>
              ← Sign in / out
            </a>
            <button className="secondary" id="refreshButton">Refresh</button>
          </div>
          <div id="errors" className="error" />
        </div>

        {/* Workspace settings + Members */}
        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Workspace</h2>
              <p>Update the workspace name, invite teammates, accept invitations, and manage the plan.</p>
            </div>

            <div>
              <label htmlFor="workspaceName">Workspace name</label>
              <input id="workspaceName" type="text" placeholder="My Workspace" />
            </div>

            <div className="row">
              <div>
                <label htmlFor="inviteEmail">Invite email</label>
                <input id="inviteEmail" type="email" placeholder="teammate@example.com" />
              </div>
              <div>
                <label htmlFor="inviteRole">Role</label>
                <select id="inviteRole">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
            </div>

            <div className="row">
              <button className="secondary" id="saveWorkspaceButton">Save name</button>
              <button id="inviteButton">Create invite</button>
              <button className="secondary" id="membersButton">Refresh members</button>
            </div>

            <div>
              <label htmlFor="inviteCode">Accept invite code</label>
              <input id="inviteCode" type="text" placeholder="invite_..." />
            </div>
            <div className="row">
              <button className="secondary" id="acceptInviteButton">Accept invite</button>
              <button className="secondary" id="planButton">Upgrade to Pro</button>
            </div>

            <div className="surface-note">
              <strong>Members &amp; invites</strong>
              <span>Members listed below include pending invitations by email.</span>
            </div>
            <div className="list" id="members" />
          </div>

          {/* Device codes + Auth sessions */}
          <div className="card stack">
            <div className="card-head">
              <h2>Devices &amp; sessions</h2>
              <p>Approve CLI device logins, review active auth sessions, and revoke access.</p>
            </div>

            <div>
              <label htmlFor="deviceCode">Device code</label>
              <input id="deviceCode" type="text" placeholder="device_..." />
            </div>
            <div className="row">
              <button className="secondary" id="approveDeviceButton">Approve device</button>
              <button className="secondary" id="authSessionsButton">Refresh sessions</button>
              <button className="secondary" id="logoutAllButton">Logout all</button>
            </div>

            <div className="muted" id="deviceStatus">Pending device approvals: 0</div>
            <div className="list" id="pendingDevices" />
            <div className="list" id="authSessions" />
          </div>
        </section>
      </main>

      {/* Hidden stubs: elements used by refresh() that don't live on this page */}
      <div style={{ display: "none" }} aria-hidden="true">
        <div id="email" /><div id="name" /><div id="turnstileToken" />
        <div id="turnstileWidget" /><div id="recoveryCodes" /><div id="passkeys" />
        <div id="dashboardPulse" />
        <div id="templates" /><div id="templateInspector" /><div id="builds" />
        <div id="sessions" />
        <div id="terminalStatus" /><div id="terminalOutput" /><div id="terminalInput" />
        <div id="snapshotList" /><div id="snapshotContentPreview" />
        <div id="usage" /><div id="report" /><div id="releases" /><div id="audit" />
      </div>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
