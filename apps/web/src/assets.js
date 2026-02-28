export const styles = `
:root {
  color-scheme: light;
  --bg: #f4efe6;
  --panel: rgba(255, 255, 255, 0.92);
  --panel-strong: #ffffff;
  --ink: #182120;
  --muted: #5d6664;
  --accent: #c25413;
  --accent-soft: #ffe1d1;
  --border: rgba(24, 33, 32, 0.12);
  --shadow: 0 18px 50px rgba(24, 33, 32, 0.08);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(circle at top right, rgba(194, 84, 19, 0.15), transparent 28%),
    linear-gradient(135deg, #f9f0e4 0%, #f4efe6 45%, #edf2ea 100%);
}

main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 20px 80px;
}

.hero {
  display: grid;
  gap: 20px;
  grid-template-columns: 1.4fr 1fr;
  align-items: start;
}

.card {
  background: var(--panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 20px;
  box-shadow: var(--shadow);
}

.title {
  margin: 0;
  font-size: clamp(2rem, 5vw, 4.4rem);
  line-height: 0.94;
  font-weight: 800;
  letter-spacing: -0.05em;
}

.subtitle {
  margin: 12px 0 0;
  color: var(--muted);
  max-width: 60ch;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 20px;
  margin-top: 24px;
}

label {
  display: block;
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 6px;
}

input,
textarea,
select,
button {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--border);
  padding: 11px 12px;
  font: inherit;
}

textarea {
  min-height: 84px;
  resize: vertical;
}

button {
  background: var(--accent);
  color: white;
  border: 0;
  cursor: pointer;
  font-weight: 700;
}

button.secondary {
  background: var(--panel-strong);
  color: var(--ink);
  border: 1px solid var(--border);
}

.stack {
  display: grid;
  gap: 12px;
}

.row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.row > * {
  flex: 1;
}

.pill {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

.list {
  display: grid;
  gap: 10px;
}

.item {
  background: var(--panel-strong);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
  font-size: 0.84rem;
  margin: 0;
}

.terminal {
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: #171b1a;
  color: #e9f0ea;
}

.terminal-input {
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

.muted { color: var(--muted); }
.error { color: #9d2500; min-height: 1.25em; }

@media (max-width: 820px) {
  .hero { grid-template-columns: 1fr; }
}
`;

export const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BurstFlare</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="card">
          <span class="pill">Cloudflare-native burst dev</span>
          <h1 class="title">BurstFlare</h1>
          <p class="subtitle">
            Shared control plane for accounts, workspace policy, build queues, container sessions, snapshots, and SSH handoff.
          </p>
        </div>
        <div class="card stack">
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
            <label for="turnstileToken">Turnstile Token</label>
            <input id="turnstileToken" type="text" placeholder="Optional when Turnstile is enabled" />
          </div>
          <div class="row">
            <button id="registerButton">Register</button>
            <button class="secondary" id="loginButton">Login</button>
            <button class="secondary" id="logoutButton">Logout</button>
          </div>
          <div class="muted" id="identity">Not signed in</div>
          <div class="error" id="errors"></div>
        </div>
      </section>

      <section class="grid">
        <div class="card stack">
          <h2>Workspace</h2>
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
          <div class="list" id="members"></div>
        </div>

        <div class="card stack">
          <h2>Auth Sessions</h2>
          <div class="muted">Review and revoke active browser or CLI sign-ins without forcing a full account-wide logout.</div>
          <div class="row">
            <button class="secondary" id="authSessionsButton">Refresh Sessions</button>
            <button class="secondary" id="logoutAllButton">Logout All Sessions</button>
          </div>
          <div class="list" id="authSessions"></div>
        </div>

        <div class="card stack">
          <h2>Templates</h2>
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
          <button class="secondary" id="addVersionButton">Queue Build</button>
          <div class="row">
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
          <div class="list" id="templates"></div>
          <pre id="builds">[]</pre>
        </div>

        <div class="card stack">
          <h2>Sessions</h2>
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
          <div class="row">
            <button class="secondary" id="refreshButton">Refresh Data</button>
            <button class="secondary" id="reconcileButton">Reconcile</button>
          </div>
          <div class="list" id="sessions"></div>
        </div>

        <div class="card stack">
          <h2>Browser Terminal</h2>
          <div class="muted" id="terminalStatus">Not connected</div>
          <pre class="terminal" id="terminalOutput">Waiting for a session attach...</pre>
          <div class="row">
            <input class="terminal-input" id="terminalInput" type="text" placeholder="Type a command or message" />
            <button class="secondary" id="terminalSendButton">Send</button>
            <button class="secondary" id="terminalCloseButton">Close</button>
          </div>
        </div>

        <div class="card stack">
          <h2>Snapshots + Reports</h2>
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
          <button id="snapshotButton">Create Snapshot</button>
          <button class="secondary" id="reportButton">Refresh Admin Report</button>
          <pre id="usage"></pre>
          <pre id="report">[]</pre>
        </div>

        <div class="card stack">
          <h2>Audit + Releases</h2>
          <pre id="releases">[]</pre>
          <pre id="audit">[]</pre>
        </div>
      </section>
    </main>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;

export const appJs = `
const state = {
  refreshToken: localStorage.getItem("burstflare_refresh_token") || "",
  csrfToken: localStorage.getItem("burstflare_csrf") || "",
  me: null,
  terminalSocket: null,
  terminalSessionId: ""
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

function appendTerminalOutput(message) {
  const current = byId("terminalOutput").textContent;
  byId("terminalOutput").textContent = current ? current + "\\n" + message : message;
  byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight;
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
  const url = new URL('/runtime/sessions/' + sessionId + '/ssh?token=' + encodeURIComponent(data.token), window.location.origin);
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

function renderIdentity() {
  byId("identity").textContent = state.me
    ? state.me.user.email + " in " + state.me.workspace.name + " (" + state.me.membership.role + ", " + state.me.workspace.plan + ")"
    : "Not signed in";
  if (state.me) {
    byId("workspaceName").value = state.me.workspace.name;
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
  byId("members").innerHTML = members.concat(invites).join("");
}

function renderAuthSessions(authSessions) {
  byId("authSessions").innerHTML = authSessions.map((session) => {
    const kinds = session.tokenKinds.join(", ");
    const action = session.current
      ? '<span class="pill" style="margin-top:8px">Current</span>'
      : '<button class="secondary" data-auth-session-revoke="' + session.id + '">Revoke</button>';
    return '<div class="item"><strong>' + session.id + '</strong><br><span class="muted">' + session.workspaceId +
      '</span><br><span class="muted">' + kinds + ' / ' + session.tokenCount + ' token(s)</span><br><span class="muted">expires ' +
      session.expiresAt + '</span><div class="row" style="margin-top:8px">' + action + '</div></div>';
  }).join("");

  document.querySelectorAll("[data-auth-session-revoke]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm('Revoke this sign-in session?')) {
        return;
      }
      await perform(async () => api('/api/auth/sessions/' + button.dataset.authSessionRevoke, { method: 'DELETE' }));
    });
  });
}

function renderTemplates(templates) {
  byId("templates").innerHTML = templates.map((template) => {
    const active = template.activeVersion ? template.activeVersion.version : "none";
    const versions = template.versions.map((entry) => entry.version + ' (' + entry.status + ')').join(", ") || "no versions";
    const status = template.archivedAt ? 'archived' : 'active';
    const stateAction = template.archivedAt
      ? '<button class="secondary" data-template-restore="' + template.id + '">Restore</button>'
      : '<button class="secondary" data-template-archive="' + template.id + '">Archive</button>';
    const deleteAction = '<button class="secondary" data-template-delete="' + template.id + '">Delete</button>';
    return '<div class="item"><strong>' + template.name + '</strong><br><span class="muted">' + template.id +
      '</span><br><span class="muted">status: ' + status + '</span><br><span class="muted">active: ' + active +
      '</span><br><span class="muted">versions: ' + versions + '</span><div class="row" style="margin-top:8px">' + stateAction + deleteAction + '</div></div>';
  }).join("");

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

function renderSessions(sessions) {
  byId("sessions").innerHTML = sessions.map((session) => {
    return '<div class="item"><strong>' + session.name + '</strong><br><span class="muted">' + session.id +
      '</span><br><span class="muted">' + session.templateName + ' / ' + session.state + '</span><div class="row" style="margin-top:8px">' +
      '<button data-start="' + session.id + '">Start</button>' +
      '<button class="secondary" data-stop="' + session.id + '">Stop</button>' +
      '<button class="secondary" data-restart="' + session.id + '">Restart</button>' +
      '<button class="secondary" data-preview="' + session.previewUrl + '">Preview</button>' +
      '<button class="secondary" data-ssh="' + session.id + '">SSH</button>' +
      '<button class="secondary" data-events="' + session.id + '">Events</button>' +
      '<button class="secondary" data-delete="' + session.id + '">Delete</button></div></div>';
  }).join("");
}

function clearPanels() {
  byId("workspaceName").value = "";
  byId("members").textContent = "";
  byId("authSessions").textContent = "";
  byId("templates").textContent = "";
  byId("builds").textContent = "";
  byId("sessions").textContent = "";
  byId("terminalInput").value = "";
  setTerminalOutput("Waiting for a session attach...");
  closeTerminal();
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
  attachSessionButtons();
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
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: byId("email").value,
        name: byId("name").value,
        turnstileToken: byId("turnstileToken").value
      })
    });
    setAuth(data.refreshToken, data.csrfToken || "");
  });
});

byId("loginButton").addEventListener("click", async () => {
  await perform(async () => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: byId("email").value,
        kind: 'browser',
        turnstileToken: byId("turnstileToken").value
      })
    });
    setAuth(data.refreshToken, data.csrfToken || "");
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
    setAuth("", "");
    state.me = null;
    renderIdentity();
    clearPanels();
  }
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
          features: ['ssh', 'browser', 'snapshots']
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
    await api('/api/sessions/' + byId("snapshotSession").value + '/snapshots', {
      method: 'POST',
      body: JSON.stringify({ label: byId("snapshotLabel").value || 'manual' })
    });
  });
});

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

if (state.refreshToken || state.csrfToken) {
  refresh().catch((error) => {
    console.error(error);
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
