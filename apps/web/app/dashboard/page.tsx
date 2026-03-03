import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Dashboard — BurstFlare",
  description: "Manage templates, sessions, snapshots, and the quick terminal.",
};

const turnstileKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

export default function DashboardPage() {
  const appScript = getAppScript(turnstileKey);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="dashboard" />

        {/* Identity + pulse bar */}
        <div className="card dashboard-topbar">
          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div className="row">
            <button className="secondary" id="refreshButton">Refresh workspace</button>
            <button className="secondary" id="reconcileButton">Run cleanup</button>
          </div>
          <div className="list" id="dashboardPulse" />
          <div id="errors" className="error" />
        </div>

        {/* Templates + Sessions + Terminal */}
        <section className="grid grid-3">
          {/* Templates */}
          <div className="card stack">
            <div className="card-head">
              <h2>Templates</h2>
              <p>Create environment specs, queue builds, and promote released versions.</p>
            </div>

            <div>
              <label htmlFor="templateName">Template name</label>
              <input id="templateName" type="text" placeholder="node-dev" />
            </div>
            <div>
              <label htmlFor="templateDescription">Description</label>
              <textarea
                id="templateDescription"
                placeholder="Node.js shell with SSH, browser access, and preview ports"
              />
            </div>
            <button id="createTemplateButton">Create template</button>

            <div className="row">
              <div>
                <label htmlFor="versionTemplate">Template ID</label>
                <input id="versionTemplate" type="text" placeholder="tpl_..." />
              </div>
              <div>
                <label htmlFor="templateVersion">Version</label>
                <input id="templateVersion" type="text" placeholder="1.0.0" />
              </div>
            </div>
            <div>
              <label htmlFor="persistedPaths">Persisted paths</label>
              <input
                id="persistedPaths"
                type="text"
                placeholder="/workspace,/home/flare/.cache"
              />
            </div>
            <div className="row">
              <button className="secondary" id="addVersionButton">Queue build</button>
              <button className="secondary" id="processBuildsButton">Process builds</button>
              <button className="secondary" id="listBuildsButton">Refresh builds</button>
            </div>

            <div className="row">
              <div>
                <label htmlFor="promoteTemplate">Template ID</label>
                <input id="promoteTemplate" type="text" placeholder="tpl_..." />
              </div>
              <div>
                <label htmlFor="promoteVersion">Version ID</label>
                <input id="promoteVersion" type="text" placeholder="tplv_..." />
              </div>
            </div>
            <button id="promoteButton">Promote version</button>

            <div className="surface-note">
              <strong>Template list</strong>
              <span>Click Inspect to load version details and pre-fill the version fields.</span>
            </div>
            <div className="list" id="templates" />
            <div className="output-shell">
              <pre id="templateInspector">Select a template to inspect.</pre>
              <pre id="builds">[]</pre>
            </div>
          </div>

          {/* Sessions */}
          <div className="card stack">
            <div className="card-head">
              <h2>Sessions</h2>
              <p>Launch and control container instances from a promoted template version.</p>
            </div>

            <div className="row">
              <div>
                <label htmlFor="sessionName">Session name</label>
                <input id="sessionName" type="text" placeholder="my-workspace" />
              </div>
              <div>
                <label htmlFor="sessionTemplate">Template ID</label>
                <input id="sessionTemplate" type="text" placeholder="tpl_..." />
              </div>
            </div>
            <button id="createSessionButton">Create &amp; start session</button>

            <div className="surface-note">
              <strong>Session list</strong>
              <span>Start, stop, restart, open preview/editor, attach SSH, or delete.</span>
            </div>
            <div className="list" id="sessions" />
          </div>

          {/* Terminal */}
          <div className="card stack">
            <div className="card-head">
              <h2>Quick terminal</h2>
              <p>Attach a lightweight WebSocket shell to any running session.</p>
            </div>

            <div className="surface-note">
              <strong>Attach a session</strong>
              <span>
                Use the SSH button in the session list to open a terminal connection here.
              </span>
            </div>
            <div className="muted" id="terminalStatus">Not connected</div>
            <pre className="terminal" id="terminalOutput">
              Waiting for a session attach...
            </pre>
            <div className="row">
              <input
                className="terminal-input"
                id="terminalInput"
                type="text"
                placeholder="Type a command or message"
              />
              <button className="secondary" id="terminalSendButton">Send</button>
              <button className="secondary" id="terminalCloseButton">Close</button>
            </div>
          </div>
        </section>

        {/* Snapshots + Releases */}
        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Snapshots &amp; health</h2>
              <p>Capture a restorable checkpoint, inspect its content, and track usage.</p>
            </div>
            <div className="row">
              <div>
                <label htmlFor="snapshotSession">Session ID</label>
                <input id="snapshotSession" type="text" placeholder="ses_..." />
              </div>
              <div>
                <label htmlFor="snapshotLabel">Label</label>
                <input id="snapshotLabel" type="text" placeholder="manual-save" />
              </div>
            </div>
            <div>
              <label htmlFor="snapshotContent">Snapshot content</label>
              <textarea
                id="snapshotContent"
                placeholder="Optional text payload to store with the snapshot"
              />
            </div>
            <div className="row">
              <button id="snapshotButton">Create snapshot</button>
              <button className="secondary" id="snapshotListButton">Load snapshots</button>
              <button className="secondary" id="reportButton">Refresh admin report</button>
            </div>
            <div className="list" id="snapshotList" />
            <div className="output-shell">
              <pre id="snapshotContentPreview">No snapshot content loaded.</pre>
              <pre id="usage" />
              <pre id="report">[]</pre>
            </div>
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Releases &amp; activity</h2>
              <p>Track release history and audit trails without leaving the dashboard.</p>
            </div>
            <div className="surface-note">
              <strong>Daily loop</strong>
              <span>
                Sign in, adjust the workspace, ship a template, launch a session, then save a
                snapshot when you want a clean checkpoint.
              </span>
            </div>
            <div className="output-shell">
              <pre id="releases">[]</pre>
              <pre id="audit">[]</pre>
            </div>
          </div>
        </section>
      </main>

      {/* Hidden stubs for elements owned by the login/profile pages */}
      <div style={{ display: "none" }} aria-hidden="true">
        <input id="email" /><input id="name" />
        <input id="turnstileToken" /><div id="turnstileWidget" />
        <div id="recoveryCodes" /><div id="passkeys" />
        <input id="workspaceName" />
        <div id="deviceStatus" /><div id="pendingDevices" /><div id="authSessions" />
      </div>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
