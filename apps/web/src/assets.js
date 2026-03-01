export const styles = `
:root {
  color-scheme: light;
  --bg: #f2eee8;
  --bg-deep: #e7dfd4;
  --panel: rgba(255, 252, 248, 0.9);
  --panel-strong: #fffdf9;
  --panel-soft: rgba(255, 250, 244, 0.72);
  --ink: #162128;
  --muted: #5b676e;
  --accent: #b44c23;
  --accent-deep: #8d3716;
  --accent-soft: rgba(180, 76, 35, 0.1);
  --line: rgba(22, 33, 40, 0.1);
  --line-strong: rgba(22, 33, 40, 0.18);
  --shadow: 0 28px 60px rgba(58, 37, 24, 0.08);
  --shadow-soft: 0 16px 32px rgba(22, 33, 40, 0.06);
}

* { box-sizing: border-box; }

html, body {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: "Satoshi", "Avenir Next", "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at 8% 10%, rgba(180, 76, 35, 0.16), transparent 22%),
    radial-gradient(circle at 88% 14%, rgba(22, 33, 40, 0.07), transparent 18%),
    radial-gradient(circle at 74% 78%, rgba(180, 76, 35, 0.08), transparent 20%),
    linear-gradient(140deg, #faf6f0 0%, var(--bg) 42%, var(--bg-deep) 100%);
}

body::before,
body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
}

body::before {
  background:
    linear-gradient(120deg, rgba(255, 255, 255, 0.5), transparent 34%),
    repeating-linear-gradient(
      135deg,
      rgba(22, 33, 40, 0.014) 0,
      rgba(22, 33, 40, 0.014) 1px,
      transparent 1px,
      transparent 17px
    );
  opacity: 0.55;
}

body::after {
  background:
    linear-gradient(to right, transparent 0, rgba(255, 255, 255, 0.18) 50%, transparent 100%);
  opacity: 0.35;
}

main {
  min-height: 100dvh;
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(16px, 2vw, 28px) clamp(14px, 2.8vw, 40px) 88px;
  position: relative;
  z-index: 1;
}

.shell {
  display: grid;
  gap: 28px;
}

.hero {
  display: grid;
  gap: 28px;
  grid-template-columns: minmax(0, 1.32fr) minmax(320px, 0.9fr);
  align-items: start;
}

.hero-main,
.hero-band,
.grid,
.stack,
.list,
.output-shell,
.quickstart-grid,
.split-panel {
  display: grid;
  gap: 18px;
}

.hero-band {
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
}

.grid {
  gap: 24px;
}

.grid.grid-2 {
  grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
}

.grid.grid-3 {
  grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.98fr) minmax(280px, 0.9fr);
}

.card {
  position: relative;
  overflow: hidden;
  border-radius: 30px;
  border: 1px solid var(--line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 250, 244, 0.82)),
    linear-gradient(140deg, rgba(180, 76, 35, 0.02), transparent 46%);
  padding: clamp(18px, 2vw, 28px);
  box-shadow: var(--shadow);
  backdrop-filter: blur(14px);
}

.card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.3), transparent 28%);
  opacity: 0.55;
}

.card > * {
  position: relative;
  z-index: 1;
}

.hero-card {
  display: grid;
  gap: 20px;
  min-height: 100%;
  background:
    radial-gradient(circle at 92% 14%, rgba(180, 76, 35, 0.14), transparent 20%),
    linear-gradient(140deg, rgba(255, 252, 247, 0.98), rgba(255, 246, 238, 0.86));
}

.hero-card::after {
  content: "";
  position: absolute;
  right: -40px;
  top: -42px;
  width: 220px;
  height: 220px;
  border-radius: 999px;
  border: 1px solid rgba(180, 76, 35, 0.14);
  background: radial-gradient(circle, rgba(180, 76, 35, 0.1), transparent 65%);
  pointer-events: none;
}

.hero-side {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 16px;
}

.eyebrow,
.pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.eyebrow {
  background: rgba(180, 76, 35, 0.1);
  color: var(--accent);
}

.eyebrow::before,
.pill::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.eyebrow::before {
  background: var(--accent);
  box-shadow: 0 0 0 5px rgba(180, 76, 35, 0.1);
}

.pill {
  background: rgba(22, 33, 40, 0.08);
  color: var(--ink);
}

.pill::before {
  background: var(--ink);
}

.hero-topline {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.section-kicker {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

.title {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(3.1rem, 7vw, 6.2rem);
  line-height: 0.9;
  letter-spacing: -0.065em;
  font-weight: 820;
}

.subtitle,
.section-copy,
.card-head p,
.muted,
.surface-note span,
.step span {
  color: var(--muted);
  line-height: 1.65;
}

.subtitle {
  margin: 0;
  max-width: 66ch;
  font-size: 1rem;
}

.hero-copy {
  display: grid;
  gap: 16px;
}

.hero-metrics {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.metric-chip {
  display: grid;
  gap: 8px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: var(--shadow-soft);
}

.metric-chip strong {
  display: block;
  font-size: 1.04rem;
  letter-spacing: -0.03em;
}

.metric-chip span {
  font-size: 0.84rem;
  color: var(--muted);
}

.hero-actions,
.row,
.inline-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.row > * {
  flex: 1 1 180px;
}

.card-head {
  display: grid;
  gap: 6px;
}

.card-head h2,
.section-title {
  margin: 0;
  font-size: clamp(1.3rem, 2vw, 1.85rem);
  line-height: 1.08;
  letter-spacing: -0.045em;
  font-weight: 780;
}

.section-copy {
  margin: 0;
}

.quickstart-shell,
.hero-pulse {
  min-height: 100%;
}

.quickstart-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 22px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: var(--panel-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.step strong {
  font-size: 0.92rem;
  letter-spacing: -0.02em;
}

.code-block {
  margin: 0;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(180, 76, 35, 0.12);
  background:
    radial-gradient(circle at 100% 0, rgba(180, 76, 35, 0.08), transparent 28%),
    linear-gradient(145deg, #171d24, #10161c);
  color: #edf3f6;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.mini-note,
.surface-note {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.62);
}

.mini-note {
  margin: 0;
  color: var(--ink);
  line-height: 1.58;
}

.surface-note strong {
  display: block;
  margin-bottom: 4px;
  font-size: 0.92rem;
  letter-spacing: -0.02em;
}

label {
  display: block;
  margin-bottom: 7px;
  font-size: 0.76rem;
  font-weight: 780;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

input,
textarea,
select {
  width: 100%;
  border-radius: 18px;
  border: 1px solid var(--line-strong);
  padding: 13px 14px;
  font: inherit;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

input:focus,
textarea:focus,
select:focus {
  outline: none;
  border-color: rgba(180, 76, 35, 0.42);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.76),
    0 0 0 4px rgba(180, 76, 35, 0.08);
}

textarea {
  min-height: 96px;
  resize: vertical;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 17px;
  padding: 12px 16px;
  font: inherit;
  font-weight: 760;
  letter-spacing: -0.01em;
  cursor: pointer;
  color: #fff7f2;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  box-shadow: 0 14px 28px rgba(180, 76, 35, 0.18);
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

button:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 32px rgba(180, 76, 35, 0.2);
  filter: saturate(1.03);
}

button:active {
  transform: translateY(1px) scale(0.99);
}

button.secondary {
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: none;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
  font-size: 0.82rem;
  line-height: 1.55;
}

.item {
  border-radius: 20px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.76);
  padding: 14px 15px;
  box-shadow: var(--shadow-soft);
}

.output-shell pre {
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.terminal {
  min-height: 240px;
  max-height: 380px;
  overflow: auto;
  padding: 16px;
  border-radius: 22px;
  border: 1px solid rgba(180, 76, 35, 0.14);
  background:
    radial-gradient(circle at 95% 0, rgba(180, 76, 35, 0.12), transparent 24%),
    linear-gradient(145deg, #11181f, #0b1016);
  color: #edf2f5;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.terminal-input {
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

.turnstile-shell {
  min-height: 72px;
  padding: 14px;
  border-radius: 20px;
  border: 1px dashed rgba(22, 33, 40, 0.16);
  background: rgba(255, 255, 255, 0.72);
}

.split-panel.columns {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.error {
  min-height: 1.25em;
  padding: 10px 12px;
  border-radius: 14px;
  color: #a13814;
  background: rgba(180, 76, 35, 0.08);
}

.section-shell {
  display: grid;
  gap: 10px;
}

@media (max-width: 1180px) {
  .hero,
  .hero-band,
  .grid.grid-2,
  .grid.grid-3,
  .split-panel.columns {
    grid-template-columns: 1fr;
  }

  .hero-side {
    position: static;
  }
}

@media (max-width: 820px) {
  main {
    padding: 14px 12px 74px;
  }

  .card {
    border-radius: 24px;
    padding: 16px;
  }

  .title {
    max-width: none;
    font-size: clamp(2.45rem, 15vw, 4rem);
  }

  .hero-metrics,
  .quickstart-grid {
    grid-template-columns: 1fr;
  }

  .row > * {
    flex-basis: 100%;
  }
}
`;

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare</title>
    <link rel="stylesheet" href="/styles.css" />
    __BURSTFLARE_TURNSTILE_SCRIPT__
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-main">
          <div class="card hero-card">
            <div class="hero-topline">
              <span class="eyebrow">BurstFlare live product</span>
              <span class="pill">Hosted by default</span>
            </div>
            <div class="hero-copy">
              <div class="section-shell">
                <p class="section-kicker">Build once. Launch often.</p>
                <h1 class="title">A real workspace hub, not another setup ritual.</h1>
              </div>
              <p class="subtitle">
                BurstFlare keeps templates, sessions, previews, access flows, terminal tools, snapshots, and activity in one place so
                teams can move from sign-in to a working environment without extra handoffs.
              </p>
            </div>
            <div class="hero-metrics">
              <div class="metric-chip">
                <strong>Templates stay ready</strong>
                <span>Create, queue, promote, and relaunch without rebuilding your whole process.</span>
              </div>
              <div class="metric-chip">
                <strong>Sessions stay close</strong>
                <span>Preview, editor, Quick Terminal, and SSH all hang off the same workspace flow.</span>
              </div>
              <div class="metric-chip">
                <strong>One default endpoint</strong>
                <span>burstflare.dev for production, with local override only when you want it.</span>
              </div>
            </div>
            <div class="hero-actions">
              <button class="secondary" id="refreshButton">Refresh Workspace</button>
              <button class="secondary" id="reconcileButton">Run Cleanup</button>
            </div>
          </div>

          <div class="hero-band">
            <div class="card quickstart-shell">
              <div class="card-head">
                <h2>Quick Start</h2>
                <p>Open the product first. Bring in the CLI when you want repeatable setup or operator workflows.</p>
              </div>
              <div class="quickstart-grid">
                <div class="step">
                  <strong>1. Open BurstFlare</strong>
                  <span>Use the hosted app to create an account and land in the full dashboard immediately.</span>
                  <pre class="code-block">https://burstflare.dev</pre>
                </div>
                <div class="step">
                  <strong>2. Add the CLI</strong>
                  <span><code>flare</code> points at the live product by default, so most users never need a URL flag.</span>
                  <pre class="code-block">npm install -g @burstflare/flare
flare auth register --email you@example.com</pre>
                </div>
                <div class="step">
                  <strong>3. Ship a template</strong>
                  <span>Create one reusable environment, upload a version, then promote the release.</span>
                  <pre class="code-block">flare template create node-dev
flare template upload &lt;templateId&gt; --version 1.0.0
flare template promote &lt;templateId&gt; &lt;versionId&gt;</pre>
                </div>
                <div class="step">
                  <strong>4. Launch a session</strong>
                  <span>Start a workspace, then jump into Preview, Editor, Quick Terminal, or SSH.</span>
                  <pre class="code-block">flare session up sandbox --template &lt;templateId&gt;
flare ssh &lt;sessionId&gt;</pre>
                </div>
              </div>
              <p class="mini-note">
                Local development still works. When you need it, pass <code>--url http://127.0.0.1:8787</code> and keep the same CLI flow.
              </p>
            </div>

            <div class="card hero-pulse">
              <div class="card-head">
                <h2>Dashboard Pulse</h2>
                <p>See what is active before you invite teammates, promote another version, or start another session.</p>
              </div>
              <div class="surface-note">
                <strong>Live workspace readout</strong>
                <span>The counts below refresh from the current workspace and keep the whole surface grounded.</span>
              </div>
              <div class="list" id="dashboardPulse"></div>
            </div>
          </div>
        </div>

        <aside class="card hero-side">
          <div class="card-head">
            <h2>Get Started</h2>
            <p>Use this rail for sign-in, passkeys, recovery, and device approval. It stays close while the rest of the dashboard moves.</p>
          </div>
          <div class="row">
            <div>
              <label for="email">Email</label>
              <input id="email" type="email" placeholder="you@example.com" />
            </div>
            <div>
              <label for="name">Name</label>
              <input id="name" type="text" placeholder="Nicholas" />
            </div>
          </div>
          <div>
            <label>Verification Challenge</label>
            <div class="turnstile-shell muted" id="turnstileWidget">The verification challenge loads automatically in the hosted app.</div>
          </div>
          <div>
            <label for="turnstileToken">Verification Token</label>
            <input id="turnstileToken" type="text" placeholder="Leave blank unless you are testing a local environment" />
          </div>
          <div class="row">
            <button id="registerButton">Register</button>
            <button class="secondary" id="loginButton">Login</button>
            <button class="secondary" id="passkeyLoginButton">Sign In With Passkey</button>
          </div>
          <div class="row">
            <button class="secondary" id="recoverButton">Use Recovery Code</button>
            <button class="secondary" id="logoutButton">Logout</button>
          </div>
          <div>
            <label for="recoveryCode">Recovery Code</label>
            <input id="recoveryCode" type="text" placeholder="recovery_..." />
          </div>
          <div class="row">
            <button class="secondary" id="recoveryCodesButton">New Recovery Codes</button>
            <button class="secondary" id="passkeyRegisterButton">Register Passkey</button>
          </div>
          <div class="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <pre class="code-block" id="recoveryCodes">No recovery codes generated.</pre>
          <div class="list" id="passkeys"></div>
          <div class="error" id="errors"></div>
        </aside>
      </section>

      <section class="grid grid-2">
        <div class="card stack">
          <div class="card-head">
            <h2>Workspace Control</h2>
            <p>Rename the active workspace, invite teammates, accept invite codes, and tune plan limits without leaving the main board.</p>
          </div>
          <div>
            <label for="workspaceName">Workspace Name</label>
            <input id="workspaceName" type="text" placeholder="My Workspace" />
          </div>
          <div class="row">
            <div>
              <label for="inviteEmail">Invite Email</label>
              <input id="inviteEmail" type="email" placeholder="teammate@example.com" />
            </div>
            <div>
              <label for="inviteRole">Role</label>
              <select id="inviteRole">
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>
          <div class="row">
            <button class="secondary" id="saveWorkspaceButton">Save Workspace</button>
            <button id="inviteButton">Create Invite</button>
            <button class="secondary" id="membersButton">Refresh Members</button>
          </div>
          <div>
            <label for="inviteCode">Accept Invite Code</label>
            <input id="inviteCode" type="text" placeholder="invite_..." />
          </div>
          <div class="row">
            <button class="secondary" id="acceptInviteButton">Accept Invite</button>
            <button class="secondary" id="planButton">Upgrade To Pro</button>
          </div>
          <div class="surface-note">
            <strong>Workspace flow</strong>
            <span>Set the workspace name, send the invite, then confirm the member list updates below.</span>
          </div>
          <div class="list" id="members"></div>
        </div>

        <div class="card stack">
          <div class="card-head">
            <h2>Sessions & Access</h2>
            <p>Review active sign-ins, approve device codes, and clean up stale access without forcing a full account reset.</p>
          </div>
          <div>
            <label for="deviceCode">Approve Device Code</label>
            <input id="deviceCode" type="text" placeholder="device_..." />
          </div>
          <div class="row">
            <button class="secondary" id="approveDeviceButton">Approve Device</button>
            <button class="secondary" id="authSessionsButton">Refresh Sessions</button>
            <button class="secondary" id="logoutAllButton">Logout All Sessions</button>
          </div>
          <div class="muted" id="deviceStatus">Pending device approvals: 0</div>
          <div class="list" id="pendingDevices"></div>
          <div class="list" id="authSessions"></div>
        </div>
      </section>

      <section class="grid grid-3">
        <div class="card stack">
          <div class="card-head">
            <h2>Template Studio</h2>
            <p>Define reusable environments, queue versions, process builds, and promote releases without leaving the same surface.</p>
          </div>
          <div>
            <label for="templateName">Template Name</label>
            <input id="templateName" type="text" placeholder="node-dev" />
          </div>
          <div>
            <label for="templateDescription">Description</label>
            <textarea id="templateDescription" placeholder="Node.js shell with SSH, browser access, and preview ports"></textarea>
          </div>
          <button id="createTemplateButton">Create Template</button>
          <div class="row">
            <div>
              <label for="versionTemplate">Template ID</label>
              <input id="versionTemplate" type="text" placeholder="tpl_..." />
            </div>
            <div>
              <label for="templateVersion">Version</label>
              <input id="templateVersion" type="text" placeholder="1.0.0" />
            </div>
          </div>
          <div>
            <label for="persistedPaths">Persisted Paths</label>
            <input id="persistedPaths" type="text" placeholder="/workspace,/home/dev/.cache" />
          </div>
          <div class="row">
            <button class="secondary" id="addVersionButton">Queue Build</button>
            <button class="secondary" id="processBuildsButton">Process Builds</button>
            <button class="secondary" id="listBuildsButton">Refresh Builds</button>
          </div>
          <div class="row">
            <div>
              <label for="promoteTemplate">Template ID</label>
              <input id="promoteTemplate" type="text" placeholder="tpl_..." />
            </div>
            <div>
              <label for="promoteVersion">Version ID</label>
              <input id="promoteVersion" type="text" placeholder="tplv_..." />
            </div>
          </div>
          <button id="promoteButton">Promote Version</button>
          <div class="surface-note">
            <strong>Release shortcut</strong>
            <span>Create a template, queue a version, refresh builds, then promote the result before launching a session.</span>
          </div>
          <div class="list" id="templates"></div>
          <div class="output-shell">
            <pre id="templateInspector">Select a template to inspect.</pre>
            <pre id="builds">[]</pre>
          </div>
        </div>

        <div class="card stack">
          <div class="card-head">
            <h2>Launch Sessions</h2>
            <p>Start a workspace from the current template and route users into preview, editor, terminal, or SSH in one sequence.</p>
          </div>
          <div class="row">
            <div>
              <label for="sessionName">Session Name</label>
              <input id="sessionName" type="text" placeholder="my-workspace" />
            </div>
            <div>
              <label for="sessionTemplate">Template ID</label>
              <input id="sessionTemplate" type="text" placeholder="tpl_..." />
            </div>
          </div>
          <button id="createSessionButton">Create Session</button>
          <div class="surface-note">
            <strong>Session flow</strong>
            <span>Create, start, inspect events, then use the quick actions on each session card to preview, edit, or attach.</span>
          </div>
          <div class="list" id="sessions"></div>
        </div>

        <div class="card stack">
          <div class="card-head">
            <h2>Quick Terminal</h2>
            <p>Use the in-browser terminal for lightweight checks, then move to SSH when you need a full native shell.</p>
          </div>
          <div class="surface-note">
            <strong>Terminal handoff</strong>
            <span>Keep this panel open for quick checks while Preview and Editor stay on the session cards.</span>
          </div>
          <div class="muted" id="terminalStatus">Not connected</div>
          <pre class="terminal" id="terminalOutput">Waiting for a session attach...</pre>
          <div class="row">
            <input class="terminal-input" id="terminalInput" type="text" placeholder="Type a command or message" />
            <button class="secondary" id="terminalSendButton">Send</button>
            <button class="secondary" id="terminalCloseButton">Close</button>
          </div>
        </div>
      </section>

      <section class="grid grid-2">
        <div class="card stack">
          <div class="card-head">
            <h2>Snapshots & Health</h2>
            <p>Capture a restorable checkpoint, inspect its content, and keep usage plus workspace health visible from one control area.</p>
          </div>
          <div class="row">
            <div>
              <label for="snapshotSession">Session ID</label>
              <input id="snapshotSession" type="text" placeholder="ses_..." />
            </div>
            <div>
              <label for="snapshotLabel">Label</label>
              <input id="snapshotLabel" type="text" placeholder="manual-save" />
            </div>
          </div>
          <div>
            <label for="snapshotContent">Snapshot Content</label>
            <textarea id="snapshotContent" placeholder="Optional text payload to store with the snapshot"></textarea>
          </div>
          <div class="row">
            <button id="snapshotButton">Create Snapshot</button>
            <button class="secondary" id="snapshotListButton">Load Snapshots</button>
            <button class="secondary" id="reportButton">Refresh Admin Report</button>
          </div>
          <div class="list" id="snapshotList"></div>
          <div class="output-shell">
            <pre id="snapshotContentPreview">No snapshot content loaded.</pre>
            <pre id="usage"></pre>
            <pre id="report">[]</pre>
          </div>
        </div>

        <div class="card stack">
          <div class="card-head">
            <h2>Releases & Activity</h2>
            <p>Track release history, audit trails, and the main workspace timeline without dropping into a separate admin screen.</p>
          </div>
          <div class="surface-note">
            <strong>Daily loop</strong>
            <span>Sign in, adjust the workspace, ship a template, launch a session, then save a snapshot when you want a clean checkpoint.</span>
          </div>
          <div class="output-shell">
            <pre id="releases">[]</pre>
            <pre id="audit">[]</pre>
          </div>
        </div>
      </section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

export const appJs = `
const TURNSTILE_SITE_KEY = __BURSTFLARE_TURNSTILE_SITE_KEY__;

const state = {
  refreshToken: localStorage.getItem("burstflare_refresh_token") || "",
  csrfToken: localStorage.getItem("burstflare_csrf") || "",
  me: null,
  terminalSocket: null,
  terminalSessionId: "",
  turnstileWidgetId: "",
  refreshTimer: null,
  refreshPending: false
};

localStorage.removeItem("burstflare_token");

function byId(id) {
  return document.getElementById(id);
}

function setError(message) {
  byId("errors").textContent = message || "";
}

function setTerminalStatus(message) {
  byId("terminalStatus").textContent = message || "Not connected";
}

function setTerminalOutput(message) {
  byId("terminalOutput").textContent = message;
  byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight;
}

function setDeviceStatus(message) {
  byId("deviceStatus").textContent = message;
}

function setLastRefresh(value) {
  byId("lastRefresh").textContent = value ? 'Last refresh: ' + value : 'Last refresh: never';
}

function setRecoveryCodes(codes = []) {
  byId("recoveryCodes").textContent = Array.isArray(codes) && codes.length
    ? codes.join("\\n")
    : "No recovery codes generated.";
}

function renderPasskeys(passkeys = []) {
  const items = passkeys.map((passkey) => {
    const action = '<button class="secondary" data-passkey-delete="' + passkey.id + '">Delete</button>';
    return '<div class="item"><strong>' + (passkey.label || passkey.id) + '</strong><br><span class="muted">' + passkey.id +
      '</span><br><span class="muted">alg ' + passkey.algorithm + '</span><br><span class="muted">created ' +
      passkey.createdAt + (passkey.lastUsedAt ? ' / used ' + passkey.lastUsedAt : '') +
      '</span><div class="row" style="margin-top:8px">' + action + '</div></div>';
  });
  byId("passkeys").innerHTML = items.length ? items.join("") : '<div class="item muted">No passkeys registered.</div>';

  document.querySelectorAll("[data-passkey-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Delete this passkey?')) {
        return;
      }
      await perform(async () => api('/api/auth/passkeys/' + button.dataset.passkeyDelete, { method: 'DELETE' }));
    });
  });
}

function renderPendingDevices(devices = []) {
  const items = devices.map((device) => {
    return '<div class="item"><strong>' + device.code + '</strong><br><span class="muted">expires ' + device.expiresAt +
      '</span><div class="row" style="margin-top:8px"><button class="secondary" data-device-approve="' + device.code +
      '">Approve</button></div></div>';
  });
  byId("pendingDevices").innerHTML = items.length ? items.join("") : '<div class="item muted">No pending device approvals.</div>';

  document.querySelectorAll("[data-device-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        await api('/api/cli/device/approve', {
          method: 'POST',
          body: JSON.stringify({ deviceCode: button.dataset.deviceApprove })
        });
      });
    });
  });
}

function isPasskeySupported() {
  return typeof window.PublicKeyCredential === 'function' && navigator.credentials && typeof navigator.credentials.create === 'function';
}

function bytesToBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || new ArrayBuffer(0));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function serializeAttestationCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      publicKey: bytesToBase64Url(response.getPublicKey ? response.getPublicKey() : new Uint8Array()),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm ? response.getPublicKeyAlgorithm() : null,
      authenticatorData: bytesToBase64Url(response.getAuthenticatorData ? response.getAuthenticatorData() : new Uint8Array()),
      transports: response.getTransports ? response.getTransports() : []
    }
  };
}

function serializeAssertionCredential(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      authenticatorData: bytesToBase64Url(response.authenticatorData),
      signature: bytesToBase64Url(response.signature),
      userHandle: response.userHandle ? bytesToBase64Url(response.userHandle) : null
    }
  };
}

function resetTurnstile() {
  byId("turnstileToken").value = "";
  if (TURNSTILE_SITE_KEY && state.turnstileWidgetId && globalThis.turnstile?.reset) {
    globalThis.turnstile.reset(state.turnstileWidgetId);
  }
}

function mountTurnstile() {
  const host = byId("turnstileWidget");
  if (!host) {
    return;
  }
  if (!TURNSTILE_SITE_KEY) {
    host.textContent = "Turnstile is not configured for this deployment.";
    return;
  }
  if (!globalThis.turnstile?.render) {
    host.textContent = "Loading Turnstile widget...";
    setTimeout(mountTurnstile, 250);
    return;
  }
  if (state.turnstileWidgetId) {
    return;
  }
  host.textContent = "";
  state.turnstileWidgetId = globalThis.turnstile.render(host, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: "light",
    callback(token) {
      byId("turnstileToken").value = token;
    },
    "expired-callback"() {
      byId("turnstileToken").value = "";
    },
    "error-callback"() {
      byId("turnstileToken").value = "";
      host.textContent = "Turnstile challenge failed. You can still paste a token manually.";
      state.turnstileWidgetId = "";
      setTimeout(mountTurnstile, 500);
    }
  });
}

function appendTerminalOutput(message) {
  const current = byId("terminalOutput").textContent;
  byId("terminalOutput").textContent = current ? current + "\\n" + message : message;
  byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight;
}

function parsePersistedPaths(value) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function setAuth(refreshToken = state.refreshToken, csrfToken = state.csrfToken) {
  state.refreshToken = refreshToken || "";
  state.csrfToken = csrfToken || "";
  if (state.refreshToken) {
    localStorage.setItem("burstflare_refresh_token", state.refreshToken);
  } else {
    localStorage.removeItem("burstflare_refresh_token");
  }
  if (state.csrfToken) {
    localStorage.setItem("burstflare_csrf", state.csrfToken);
  } else {
    localStorage.removeItem("burstflare_csrf");
  }
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function startAutoRefresh() {
  if (state.refreshTimer || (!state.refreshToken && !state.csrfToken)) {
    return;
  }
  state.refreshTimer = setInterval(() => {
    if (state.refreshPending) {
      return;
    }
    state.refreshPending = true;
    refresh().catch((error) => {
      console.error(error);
    }).finally(() => {
      state.refreshPending = false;
    });
  }, 15000);
}

function closeTerminal(message = "Not connected") {
  if (state.terminalSocket) {
    const socket = state.terminalSocket;
    state.terminalSocket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close(1000, "Closed");
    }
  }
  state.terminalSessionId = "";
  setTerminalStatus(message);
}

async function openTerminal(sessionId) {
  closeTerminal("Connecting...");
  setTerminalOutput("Connecting to " + sessionId + "...");
  const data = await api('/api/sessions/' + sessionId + '/ssh-token', { method: 'POST' });
  const url = new URL('/runtime/sessions/' + sessionId + '/terminal?token=' + encodeURIComponent(data.token), window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url.toString());
  state.terminalSocket = socket;
  state.terminalSessionId = sessionId;
  socket.onopen = () => {
    setTerminalStatus('Connected to ' + sessionId);
    appendTerminalOutput('connected');
  };
  socket.onmessage = (event) => {
    appendTerminalOutput(String(event.data ?? ''));
  };
  socket.onerror = () => {
    setTerminalStatus('Terminal connection failed');
    appendTerminalOutput('connection error');
  };
  socket.onclose = () => {
    state.terminalSocket = null;
    setTerminalStatus('Disconnected');
  };
}

function sendTerminalInput() {
  const value = byId("terminalInput").value;
  if (!value) {
    return;
  }
  if (!state.terminalSocket || state.terminalSocket.readyState !== WebSocket.OPEN) {
    throw new Error("Terminal is not connected");
  }
  state.terminalSocket.send(value);
  appendTerminalOutput('> ' + value);
  byId("terminalInput").value = "";
}

async function refreshAuth() {
  if (!state.refreshToken) {
    throw new Error("Authentication expired");
  }
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    stopAutoRefresh();
    setAuth("", "");
    throw new Error(data.error || "Authentication expired");
  }
  setAuth(data.refreshToken, data.csrfToken || "");
  return data;
}

async function api(path, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("content-type") && options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers.set("x-burstflare-csrf", state.csrfToken);
  }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && allowRetry && state.refreshToken) {
    await refreshAuth();
    return api(path, options, false);
  }
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function requestRaw(path, options = {}, allowRetry = true) {
  const headers = new Headers(options.headers || {});
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers.set("x-burstflare-csrf", state.csrfToken);
  }
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && allowRetry && state.refreshToken) {
    await refreshAuth();
    return requestRaw(path, options, false);
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(bodyText || "Request failed");
  }
  return response;
}

async function registerPasskey() {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }
  const start = await api('/api/auth/passkeys/register/start', {
    method: 'POST'
  });
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToBytes(start.publicKey.challenge),
      rp: {
        name: 'BurstFlare',
        id: start.publicKey.rpId
      },
      user: {
        id: base64UrlToBytes(start.publicKey.user.id),
        name: start.publicKey.user.name,
        displayName: start.publicKey.user.displayName
      },
      timeout: start.publicKey.timeoutMs,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      pubKeyCredParams: start.publicKey.pubKeyCredParams,
      excludeCredentials: (start.publicKey.excludeCredentialIds || []).map((id) => ({
        type: 'public-key',
        id: base64UrlToBytes(id)
      }))
    }
  });
  if (!credential) {
    throw new Error("Passkey registration was cancelled");
  }
  await api('/api/auth/passkeys/register/finish', {
    method: 'POST',
    body: JSON.stringify({
      challengeId: start.challengeId,
      label: byId("name").value || byId("email").value || 'BurstFlare Passkey',
      credential: serializeAttestationCredential(credential)
    })
  });
}

async function loginWithPasskey() {
  if (!isPasskeySupported()) {
    throw new Error("Passkeys are not supported in this browser");
  }
  try {
    const start = await api('/api/auth/passkeys/login/start', {
      method: 'POST',
      body: JSON.stringify({
        email: byId("email").value,
        turnstileToken: byId("turnstileToken").value
      })
    });
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64UrlToBytes(start.publicKey.challenge),
        rpId: start.publicKey.rpId,
        timeout: start.publicKey.timeoutMs,
        userVerification: start.publicKey.userVerification || 'preferred',
        allowCredentials: (start.publicKey.allowCredentialIds || []).map((id) => ({
          type: 'public-key',
          id: base64UrlToBytes(id)
        }))
      }
    });
    if (!credential) {
      throw new Error("Passkey login was cancelled");
    }
    const data = await api('/api/auth/passkeys/login/finish', {
      method: 'POST',
      body: JSON.stringify({
        challengeId: start.challengeId,
        credential: serializeAssertionCredential(credential)
      })
    });
    setAuth(data.refreshToken, data.csrfToken || "");
  } finally {
    resetTurnstile();
  }
}

function renderIdentity() {
  byId("identity").textContent = state.me
    ? state.me.user.email + " in " + state.me.workspace.name + " (" + state.me.membership.role + ", " + state.me.workspace.plan + ")"
    : "Not signed in";
  if (state.me) {
    byId("workspaceName").value = state.me.workspace.name;
    setDeviceStatus('Pending device approvals: ' + state.me.pendingDeviceCodes);
    renderPasskeys(state.me.passkeys || []);
    renderPendingDevices(state.me.pendingDevices || []);
  } else {
    setDeviceStatus('Pending device approvals: 0');
    renderPasskeys([]);
    renderPendingDevices([]);
  }
}

function renderMembers(membersData) {
  const members = membersData.members.map((member) => {
    const email = member.user ? member.user.email : member.userId;
    return '<div class="item"><strong>' + email + '</strong><br><span class="muted">' + member.role + '</span></div>';
  });
  const invites = membersData.invites.map((invite) => {
    return '<div class="item"><strong>' + invite.email + '</strong><br><span class="muted">' + invite.role +
      ' / ' + invite.code + '</span></div>';
  });
  const items = members.concat(invites);
  byId("members").innerHTML = items.length ? items.join("") : '<div class="item muted">No members or invites yet.</div>';
}

function renderAuthSessions(authSessions) {
  const items = authSessions.map((session) => {
    const kinds = session.tokenKinds.join(", ");
    const action = session.current
      ? '<span class="pill" style="margin-top:8px">Current</span>'
      : '<button class="secondary" data-auth-session-revoke="' + session.id + '">Revoke</button>';
    return '<div class="item"><strong>' + session.id + '</strong><br><span class="muted">' + session.workspaceId +
      '</span><br><span class="muted">' + kinds + ' / ' + session.tokenCount + ' token(s)</span><br><span class="muted">expires ' +
      session.expiresAt + '</span><div class="row" style="margin-top:8px">' + action + '</div></div>';
  });
  byId("authSessions").innerHTML = items.length ? items.join("") : '<div class="item muted">No active auth sessions.</div>';

  document.querySelectorAll("[data-auth-session-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Revoke this sign-in session?')) {
        return;
      }
      await perform(async () => api('/api/auth/sessions/' + button.dataset.authSessionRevoke, { method: 'DELETE' }));
    });
  });
}

function renderDashboardPulse(counts) {
  const items = [
    {
      label: 'templates',
      value: counts.templates
    },
    {
      label: 'builds',
      value: counts.builds
    },
    {
      label: 'sessions',
      value: counts.sessions
    },
    {
      label: 'snapshots',
      value: counts.snapshots
    }
  ];
  byId("dashboardPulse").innerHTML = items
    .map((item) => '<div class="item"><strong>' + item.value + '</strong><br><span class="muted">' + item.label + '</span></div>')
    .join("");
}

function renderTemplates(templates) {
  const items = templates.map((template) => {
    const active = template.activeVersion ? template.activeVersion.version : "none";
    const versions = template.versions.map((entry) => entry.version + ' (' + entry.status + ')').join(", ") || "no versions";
    const status = template.archivedAt ? 'archived' : 'active';
    const bundleBytes = template.storageSummary ? template.storageSummary.bundleBytes || 0 : 0;
    const stateAction = template.archivedAt
      ? '<button class="secondary" data-template-restore="' + template.id + '">Restore</button>'
      : '<button class="secondary" data-template-archive="' + template.id + '">Archive</button>';
    const inspectAction = '<button class="secondary" data-template-inspect="' + template.id + '">Inspect</button>';
    const deleteAction = '<button class="secondary" data-template-delete="' + template.id + '">Delete</button>';
    return '<div class="item"><strong>' + template.name + '</strong><br><span class="muted">' + template.id +
      '</span><br><span class="muted">status: ' + status + '</span><br><span class="muted">active: ' + active +
      '</span><br><span class="muted">versions: ' + versions + '</span><br><span class="muted">releases: ' + (template.releaseCount || 0) +
      '</span><br><span class="muted">bundle bytes: ' + bundleBytes + '</span><div class="row" style="margin-top:8px">' +
      inspectAction + stateAction + deleteAction + '</div></div>';
  });
  byId("templates").innerHTML = items.length ? items.join("") : '<div class="item muted">No templates yet.</div>';
  if (!items.length) {
    renderTemplateInspector(null);
  }

  document.querySelectorAll("[data-template-inspect]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const detail = await api('/api/templates/' + button.dataset.templateInspect);
        renderTemplateInspector(detail.template);
      });
    });
  });

  document.querySelectorAll("[data-template-archive]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/templates/' + button.dataset.templateArchive + '/archive', { method: 'POST' }));
    });
  });

  document.querySelectorAll("[data-template-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/templates/' + button.dataset.templateRestore + '/restore', { method: 'POST' }));
    });
  });

  document.querySelectorAll("[data-template-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Delete this template and its stored versions?')) {
        return;
      }
      await perform(async () => api('/api/templates/' + button.dataset.templateDelete, { method: 'DELETE' }));
    });
  });
}

function renderTemplateInspector(template) {
  if (!template) {
    byId("templateInspector").textContent = "Select a template to inspect.";
    return;
  }

  byId("versionTemplate").value = template.id;
  byId("promoteTemplate").value = template.id;

  const lines = [
    'name: ' + template.name,
    'id: ' + template.id,
    'status: ' + (template.archivedAt ? 'archived' : 'active'),
    'activeVersion: ' + (template.activeVersion ? template.activeVersion.version + ' (' + template.activeVersion.id + ')' : 'none'),
    'versions: ' + template.versions.length,
    'releases: ' + (template.releases ? template.releases.length : template.releaseCount || 0),
    'bundleBytes: ' + (template.storageSummary ? template.storageSummary.bundleBytes || 0 : 0),
    'buildArtifactBytes: ' + (template.storageSummary ? template.storageSummary.buildArtifactBytes || 0 : 0),
    'buildSummary: queued=' + (template.buildSummary?.queued || 0) +
      ', building=' + (template.buildSummary?.building || 0) +
      ', succeeded=' + (template.buildSummary?.succeeded || 0) +
      ', failed=' + (template.buildSummary?.failed || 0) +
      ', deadLettered=' + (template.buildSummary?.deadLettered || 0)
  ];

  if (Array.isArray(template.versions) && template.versions.length) {
    lines.push('');
    lines.push('versions:');
    template.versions.forEach((version) => {
      lines.push(
        '- ' + version.version + ' [' + version.id + '] build=' + (version.build?.status || 'none') +
        ' bundle=' + (version.bundleBytes || 0) + ' bytes'
      );
    });
  }

  if (Array.isArray(template.releases) && template.releases.length) {
    lines.push('');
    lines.push('releases:');
    template.releases.forEach((release) => {
      lines.push('- ' + release.id + ' version=' + release.versionId + ' mode=' + release.mode);
    });
  }

  byId("templateInspector").textContent = lines.join("\\n");
}

function renderSessions(sessions) {
  const items = sessions.map((session) => {
    const runtimeMeta = session.runtime
      ? '<br><span class="muted">runtime: ' + session.runtime.status + ' / ' + session.runtime.runtimeState + '</span>'
      : '';
    const restoreMeta = session.lastRestoredSnapshotId
      ? '<br><span class="muted">restored: ' + session.lastRestoredSnapshotId + '</span>'
      : '';
    return '<div class="item"><strong>' + session.name + '</strong><br><span class="muted">' + session.id +
      '</span><br><span class="muted">' + session.templateName + ' / ' + session.state + '</span>' + runtimeMeta + restoreMeta + '<div class="row" style="margin-top:8px">' +
      '<button data-start="' + session.id + '">Start</button>' +
      '<button class="secondary" data-stop="' + session.id + '">Stop</button>' +
      '<button class="secondary" data-restart="' + session.id + '">Restart</button>' +
      '<button class="secondary" data-preview="' + session.previewUrl + '">Preview</button>' +
      '<button class="secondary" data-editor="' + session.id + '">Editor</button>' +
      '<button class="secondary" data-ssh="' + session.id + '">SSH</button>' +
      '<button class="secondary" data-events="' + session.id + '">Events</button>' +
      '<button class="secondary" data-delete="' + session.id + '">Delete</button></div></div>';
  });
  byId("sessions").innerHTML = items.length ? items.join("") : '<div class="item muted">No sessions yet.</div>';
}

function renderSnapshots(snapshots) {
  const items = snapshots.map((snapshot) => {
    return '<div class="item"><strong>' + snapshot.label + '</strong><br><span class="muted">' + snapshot.id +
      '</span><br><span class="muted">' + (snapshot.bytes || 0) + ' bytes</span><div class="row" style="margin-top:8px">' +
      '<button class="secondary" data-snapshot-download="' + snapshot.id + '">View</button>' +
      '<button class="secondary" data-snapshot-restore="' + snapshot.id + '">Restore</button>' +
      '<button class="secondary" data-snapshot-delete="' + snapshot.id + '">Delete</button></div></div>';
  });
  byId("snapshotList").innerHTML = items.length ? items.join("") : '<div class="item muted">No snapshots for this session.</div>';

  document.querySelectorAll("[data-snapshot-download]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        const response = await requestRaw('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotDownload + '/content');
        const text = await response.text();
        byId("snapshotContentPreview").textContent = text || "Snapshot content is empty.";
      });
    });
  });

  document.querySelectorAll("[data-snapshot-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        await api('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotDelete, {
          method: 'DELETE'
        });
      });
    });
  });

  document.querySelectorAll("[data-snapshot-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const sessionId = byId("snapshotSession").value;
        await api('/api/sessions/' + sessionId + '/snapshots/' + button.dataset.snapshotRestore + '/restore', {
          method: 'POST'
        });
      });
    });
  });
}

async function refreshSnapshots() {
  const sessionId = byId("snapshotSession").value;
  if (!sessionId) {
    byId("snapshotList").textContent = "";
    byId("snapshotContentPreview").textContent = "No snapshot content loaded.";
    return;
  }
  const data = await api('/api/sessions/' + sessionId + '/snapshots');
  renderSnapshots(data.snapshots);
}

function clearPanels() {
  byId("deviceCode").value = "";
  byId("workspaceName").value = "";
  byId("persistedPaths").value = "";
  byId("members").textContent = "";
  byId("authSessions").textContent = "";
  byId("pendingDevices").textContent = "";
  byId("dashboardPulse").textContent = "";
  byId("templates").textContent = "";
  byId("builds").textContent = "";
  byId("sessions").textContent = "";
  byId("terminalInput").value = "";
  setTerminalOutput("Waiting for a session attach...");
  closeTerminal();
  byId("snapshotContent").value = "";
  byId("snapshotList").textContent = "";
  byId("snapshotContentPreview").textContent = "No snapshot content loaded.";
  setLastRefresh("");
  setRecoveryCodes();
  renderPasskeys([]);
  resetTurnstile();
  byId("usage").textContent = "";
  byId("report").textContent = "";
  byId("releases").textContent = "";
  byId("audit").textContent = "";
}

function attachSessionButtons() {
  document.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.start + '/start', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-stop]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.stop + '/stop', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-restart]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.restart + '/restart', { method: 'POST' }));
    });
  });
  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => api('/api/sessions/' + button.dataset.delete, { method: 'DELETE' }));
    });
  });
  document.querySelectorAll("[data-ssh]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        await openTerminal(button.dataset.ssh);
      });
    });
  });
  document.querySelectorAll("[data-preview]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open(button.dataset.preview, "_blank", "noopener");
    });
  });
  document.querySelectorAll("[data-editor]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open('/runtime/sessions/' + button.dataset.editor + '/editor', "_blank", "noopener");
    });
  });
  document.querySelectorAll("[data-events]").forEach((button) => {
    button.addEventListener("click", async () => {
      await perform(async () => {
        const data = await api('/api/sessions/' + button.dataset.events + '/events');
        alert(JSON.stringify(data.events, null, 2));
      });
    });
  });
}

async function refresh() {
  if (!state.refreshToken && !state.csrfToken) {
    return;
  }
  state.me = await api('/api/auth/me');
  startAutoRefresh();
  setLastRefresh(new Date().toLocaleTimeString());
  renderIdentity();
  renderMembers(await api('/api/workspaces/current/members'));
  const authSessions = await api('/api/auth/sessions');
  renderAuthSessions(authSessions.sessions);
  const templates = await api('/api/templates');
  renderTemplates(templates.templates);
  const builds = await api('/api/template-builds');
  byId("builds").textContent = JSON.stringify(builds.builds, null, 2);
  const sessions = await api('/api/sessions');
  renderSessions(sessions.sessions);
  renderDashboardPulse({
    templates: templates.templates.length,
    builds: builds.builds.length,
    sessions: sessions.sessions.length,
    snapshots: sessions.sessions.reduce((sum, entry) => sum + (entry.snapshotCount || 0), 0)
  });
  attachSessionButtons();
  await refreshSnapshots();
  const usage = await api('/api/usage');
  byId("usage").textContent = JSON.stringify(usage, null, 2);
  const report = await api('/api/admin/report');
  byId("report").textContent = JSON.stringify(report.report, null, 2);
  const releases = await api('/api/releases');
  byId("releases").textContent = JSON.stringify(releases.releases, null, 2);
  const audit = await api('/api/audit');
  byId("audit").textContent = JSON.stringify(audit.audit, null, 2);
}

async function perform(action) {
  setError("");
  try {
    await action();
    await refresh();
  } catch (error) {
    console.error(error);
    setError(error.message || "Request failed");
  }
}

byId("registerButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          name: byId("name").value,
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
    } finally {
      resetTurnstile();
    }
  });
});

byId("loginButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          kind: 'browser',
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
    } finally {
      resetTurnstile();
    }
  });
});

byId("passkeyLoginButton").addEventListener("click", async () => {
  await perform(async () => {
    await loginWithPasskey();
  });
});

byId("recoverButton").addEventListener("click", async () => {
  await perform(async () => {
    try {
      const data = await api('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({
          email: byId("email").value,
          code: byId("recoveryCode").value,
          turnstileToken: byId("turnstileToken").value
        })
      });
      setAuth(data.refreshToken, data.csrfToken || "");
      byId("recoveryCode").value = "";
    } finally {
      resetTurnstile();
    }
  });
});

byId("logoutButton").addEventListener("click", async () => {
  setError("");
  try {
    if (state.refreshToken) {
      await api('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: state.refreshToken })
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
  }
});

byId("recoveryCodesButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/auth/recovery-codes/generate', {
      method: 'POST',
      body: JSON.stringify({})
    });
    setRecoveryCodes(data.recoveryCodes || []);
  });
});

byId("passkeyRegisterButton").addEventListener("click", async () => {
  await perform(async () => {
    await registerPasskey();
  });
});

byId("logoutAllButton").addEventListener("click", async () => {
  setError("");
  try {
    if (state.refreshToken || state.csrfToken) {
      await api('/api/auth/logout-all', {
        method: 'POST'
      });
    }
  } catch (error) {
    console.error(error);
  } finally {
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
  }
});

byId("inviteButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: byId("inviteEmail").value, role: byId("inviteRole").value })
    });
    byId("inviteCode").value = data.invite.code;
  });
});

byId("saveWorkspaceButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/settings', {
      method: 'PATCH',
      body: JSON.stringify({ name: byId("workspaceName").value })
    });
  });
});

byId("membersButton").addEventListener("click", () => perform(async () => {}));

byId("approveDeviceButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/cli/device/approve', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: byId("deviceCode").value })
    });
    byId("deviceCode").value = "";
  });
});

byId("authSessionsButton").addEventListener("click", () => perform(async () => {}));

byId("acceptInviteButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ inviteCode: byId("inviteCode").value })
    });
  });
});

byId("planButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/workspaces/current/plan', {
      method: 'POST',
      body: JSON.stringify({ plan: 'pro' })
    });
  });
});

byId("createTemplateButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: byId("templateName").value,
        description: byId("templateDescription").value
      })
    });
  });
});

byId("addVersionButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates/' + byId("versionTemplate").value + '/versions', {
      method: 'POST',
      body: JSON.stringify({
        version: byId("templateVersion").value,
        manifest: {
          image: 'registry.cloudflare.com/example/' + byId("versionTemplate").value + ':' + byId("templateVersion").value,
          features: ['ssh', 'browser', 'snapshots'],
          persistedPaths: parsePersistedPaths(byId("persistedPaths").value)
        }
      })
    });
  });
});

byId("processBuildsButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/template-builds/process', { method: 'POST' });
  });
});

byId("listBuildsButton").addEventListener("click", () => perform(async () => {}));

byId("promoteButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/templates/' + byId("promoteTemplate").value + '/promote', {
      method: 'POST',
      body: JSON.stringify({ versionId: byId("promoteVersion").value })
    });
  });
});

byId("createSessionButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name: byId("sessionName").value,
        templateId: byId("sessionTemplate").value
      })
    });
    await api('/api/sessions/' + data.session.id + '/start', { method: 'POST' });
  });
});

byId("snapshotButton").addEventListener("click", async () => {
  await perform(async () => {
    const sessionId = byId("snapshotSession").value;
    const created = await api('/api/sessions/' + sessionId + '/snapshots', {
      method: 'POST',
      body: JSON.stringify({ label: byId("snapshotLabel").value || 'manual' })
    });
    const snapshotBody = byId("snapshotContent").value;
    if (snapshotBody) {
      await api('/api/sessions/' + sessionId + '/snapshots/' + created.snapshot.id + '/content', {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain; charset=utf-8'
        },
        body: snapshotBody
      });
      byId("snapshotContentPreview").textContent = snapshotBody;
    }
  });
});

byId("snapshotListButton").addEventListener("click", () => perform(async () => {
  await refreshSnapshots();
}));

byId("refreshButton").addEventListener("click", () => perform(async () => {}));

byId("terminalSendButton").addEventListener("click", async () => {
  await perform(async () => {
    sendTerminalInput();
  });
});

byId("terminalCloseButton").addEventListener("click", () => {
  closeTerminal();
});

byId("terminalInput").addEventListener("keydown", async (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  await perform(async () => {
    sendTerminalInput();
  });
});

byId("reconcileButton").addEventListener("click", async () => {
  await perform(async () => {
    await api('/api/admin/reconcile', { method: 'POST' });
  });
});

byId("reportButton").addEventListener("click", () => perform(async () => {}));

mountTurnstile();

if (state.refreshToken || state.csrfToken) {
  refresh().catch((error) => {
    console.error(error);
    stopAutoRefresh();
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
    setError(error.message || "Could not restore session");
  });
} else {
  renderIdentity();
}
`;
