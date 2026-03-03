import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Profile - BurstFlare",
  description: "Manage workspace settings, billing, and active browser sessions."
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

        <div className="card">
          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" id="refreshProfileButton">Refresh</button>
            <button className="secondary" id="logoutAllButton">Logout all</button>
          </div>
          <div id="errors" className="error" />
        </div>

        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Workspace</h2>
              <p>Rename the primary workspace and switch it to the Pro plan when needed.</p>
            </div>
            <div>
              <label htmlFor="workspaceName">Workspace name</label>
              <input id="workspaceName" type="text" placeholder="My workspace" />
            </div>
            <div className="row">
              <button className="secondary" id="saveWorkspaceButton">Save name</button>
              <button id="planButton">Upgrade to Pro</button>
            </div>
            <pre id="billingSummary">{"{}"}</pre>
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Browser sessions</h2>
              <p>Review active browser sessions and revoke any session that should be closed.</p>
            </div>
            <div className="row">
              <button className="secondary" id="authSessionsButton">Refresh sessions</button>
            </div>
            <div className="list" id="authSessions" />
          </div>
        </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
