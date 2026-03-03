import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";

export const metadata = {
  title: "Concepts — BurstFlare",
  description:
    "Learn about workspaces, templates, sessions, snapshots, and other core concepts in BurstFlare.",
};

export default function DocsPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <style dangerouslySetInnerHTML={{ __html: docsStyles }} />
      <main className="shell">
        <SiteNav active="docs" />

        {/* Header */}
        <div className="docs-header card">
          <div className="docs-header-inner">
            <div className="docs-header-top">
              <div className="hero-topline">
                <span className="eyebrow">Documentation</span>
                <span className="pill">Core concepts</span>
              </div>
              <a href="/docs/raw" className="docs-markdown-link" title="Plain Markdown — for agents and LLMs">
                <span className="docs-markdown-icon">⬡</span> Markdown
              </a>
            </div>
            <div className="docs-hero-copy">
              <h1 className="docs-title">How BurstFlare works</h1>
              <p className="subtitle">
                BurstFlare is organized around four building blocks: workspaces, templates, sessions,
                and snapshots. Understanding how they fit together makes everything else click.
              </p>
            </div>
          </div>

          {/* Quick nav */}
          <nav className="docs-toc">
            {[
              { href: "#workspaces", label: "Workspaces" },
              { href: "#templates", label: "Templates" },
              { href: "#sessions", label: "Sessions" },
              { href: "#snapshots", label: "Snapshots" },
              { href: "#secrets", label: "Secrets" },
              { href: "#access", label: "Access & roles" },
            ].map(({ href, label }) => (
              <a key={href} href={href} className="docs-toc-link">
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/* Overview diagram */}
        <div className="card docs-overview">
          <div className="card-head">
            <h2 className="section-title">How the pieces fit together</h2>
            <p className="section-copy">
              Every resource in BurstFlare belongs to a workspace. Templates define the environment;
              sessions run it.
            </p>
          </div>
          <div className="docs-diagram">
            <div className="docs-diagram-node docs-diagram-root">
              <strong>Workspace</strong>
              <span>billing boundary, members, secrets</span>
            </div>
            <div className="docs-diagram-arrow">↓</div>
            <div className="docs-diagram-row">
              <div className="docs-diagram-node">
                <strong>Templates</strong>
                <span>reusable environment specs</span>
              </div>
              <div className="docs-diagram-connector">→ instantiate →</div>
              <div className="docs-diagram-node">
                <strong>Sessions</strong>
                <span>live container instances</span>
              </div>
              <div className="docs-diagram-connector">→ persist via →</div>
              <div className="docs-diagram-node">
                <strong>Snapshots</strong>
                <span>point-in-time captures</span>
              </div>
            </div>
          </div>
        </div>

        {/* Workspaces */}
        <section id="workspaces" className="docs-section">
          <div className="card docs-concept-header">
            <div className="hero-topline">
              <span className="eyebrow">Workspaces</span>
            </div>
            <h2 className="docs-concept-title">The container for everything</h2>
            <p className="subtitle">
              A workspace is the top-level organizational unit. It holds your templates, sessions,
              team members, billing, and runtime secrets. Think of it as an isolated account that
              your whole team shares.
            </p>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h3>Plans and quotas</h3>
                <p>Each workspace runs on a plan that defines its resource limits.</p>
              </div>
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Limit</th>
                      <th>Free</th>
                      <th>Pro</th>
                      <th>Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Templates</td><td>10</td><td>100</td><td>1,000</td></tr>
                    <tr><td>Running sessions</td><td>3</td><td>20</td><td>200</td></tr>
                    <tr><td>Versions / template</td><td>25</td><td>250</td><td>2,500</td></tr>
                    <tr><td>Snapshots / session</td><td>25</td><td>250</td><td>2,500</td></tr>
                    <tr><td>Storage</td><td>25 MB</td><td>250 MB</td><td>2.5 GB</td></tr>
                    <tr><td>Runtime minutes / mo</td><td>500</td><td>10,000</td><td>100,000</td></tr>
                    <tr><td>Builds / mo</td><td>100</td><td>2,000</td><td>20,000</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-head">
                  <h3>Member roles</h3>
                  <p>Role-based access controls what each team member can do.</p>
                </div>
                <div className="stack">
                  {[
                    { role: "owner", desc: "Full control — billing, members, all resources." },
                    { role: "admin", desc: "Manages templates, sessions, and workspace settings." },
                    { role: "member", desc: "Creates and manages sessions, views templates." },
                    { role: "viewer", desc: "Read-only access across the workspace." },
                  ].map(({ role, desc }) => (
                    <div key={role} className="docs-role-row">
                      <code className="docs-badge">{role}</code>
                      <span className="muted">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="surface-note">
                <strong>Invitations</strong>
                <span>
                  Invite teammates by email. They receive a link, accept it, and land directly in
                  the workspace — no separate sign-up step required.
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>CLI quick reference</h3>
            </div>
            <div className="quickstart-grid">
              {[
                { cmd: "flare workspace list", desc: "List workspaces you have access to." },
                { cmd: "flare workspace members", desc: "Show members in the current workspace." },
                { cmd: "flare workspace invite --email you@example.com --role member", desc: "Invite a teammate." },
              ].map(({ cmd, desc }) => (
                <div key={cmd} className="step">
                  <pre className="code-block">{cmd}</pre>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Templates */}
        <section id="templates" className="docs-section">
          <div className="card docs-concept-header">
            <div className="hero-topline">
              <span className="eyebrow">Templates</span>
            </div>
            <h2 className="docs-concept-title">Reusable environment definitions</h2>
            <p className="subtitle">
              A template is a versioned specification that describes what runs inside a session —
              the container image, enabled features, file paths to persist, and idle-sleep
              behaviour. You build it once and launch it as many times as you need.
            </p>
          </div>

          <div className="grid grid-3">
            <div className="metric-chip">
              <strong>Versioned</strong>
              <span>Every change is a new version. Promote when ready, roll back when needed.</span>
            </div>
            <div className="metric-chip">
              <strong>Build pipeline</strong>
              <span>Upload a bundle → build runs in the cloud → artifacts pushed to registry.</span>
            </div>
            <div className="metric-chip">
              <strong>Always promotable</strong>
              <span>Only <em>promoted</em> versions are used by new sessions. Roll back in one command.</span>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h3>Template manifest</h3>
                <p>The manifest lives inside your uploaded bundle and drives what the build produces.</p>
              </div>
              <pre className="code-block">{`{
  "image": "node:22-slim",
  "features": ["ssh", "browser", "snapshots"],
  "persistedPaths": ["/home/user/project"],
  "sleepTtlSeconds": 1800
}`}</pre>
              <div className="stack docs-manifest-fields">
                {[
                  { field: "image", desc: "Container image reference (required)." },
                  { field: "features", desc: "Opt-in capabilities: ssh, browser, snapshots." },
                  { field: "persistedPaths", desc: "Up to 8 paths preserved between sessions." },
                  { field: "sleepTtlSeconds", desc: "Auto-sleep after this many idle seconds (1 s – 7 days)." },
                ].map(({ field, desc }) => (
                  <div key={field} className="docs-field-row">
                    <code className="docs-badge">{field}</code>
                    <span className="muted">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Version lifecycle</h3>
                <p>Each version moves through a fixed sequence of states.</p>
              </div>
              <div className="stack">
                {[
                  { state: "queued", color: "neutral", desc: "Bundle uploaded, waiting for a build worker." },
                  { state: "building", color: "active", desc: "Image is being built and pushed to the registry." },
                  { state: "buildFailed", color: "danger", desc: "Build errored. Check the build log in the dashboard." },
                  { state: "promotable", color: "ready", desc: "Build succeeded. Ready to promote to active." },
                  { state: "promoted", color: "accent", desc: "Active version — used by all new sessions." },
                  { state: "archived", color: "neutral", desc: "Retired. Can be unarchived if needed." },
                ].map(({ state, color, desc }) => (
                  <div key={state} className="docs-state-row">
                    <span className={`docs-state-pill docs-state-${color}`}>{state}</span>
                    <span className="muted">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>CLI quick reference</h3>
            </div>
            <div className="quickstart-grid">
              {[
                { cmd: "flare template create node-dev", desc: "Create a new template." },
                { cmd: "flare template upload <id> --version 1.0.0 --file bundle.tar.gz", desc: "Upload a version bundle." },
                { cmd: "flare template promote <id> <versionId>", desc: "Promote a version to active." },
                { cmd: "flare template rollback <id>", desc: "Revert to the previously promoted version." },
              ].map(({ cmd, desc }) => (
                <div key={cmd} className="step">
                  <pre className="code-block">{cmd}</pre>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Sessions */}
        <section id="sessions" className="docs-section">
          <div className="card docs-concept-header">
            <div className="hero-topline">
              <span className="eyebrow">Sessions</span>
            </div>
            <h2 className="docs-concept-title">Live container instances</h2>
            <p className="subtitle">
              A session is a running instance of a promoted template version. It has a full
              lifecycle — from created through running and sleeping all the way to deleted. Each
              session gets its own preview URL, SSH access, and editor endpoint.
            </p>
          </div>

          {/* State machine */}
          <div className="card">
            <div className="card-head">
              <h3>Session state machine</h3>
              <p>Sessions transition through states as you start, stop, and delete them.</p>
            </div>
            <div className="docs-states-flow">
              {[
                { state: "created", desc: "Just created, not yet started." },
                { state: "starting", desc: "Container initialising, bootstrap running." },
                { state: "running", desc: "Container is ready and accepting connections." },
                { state: "sleeping", desc: "Idle timeout reached — dormant but recoverable." },
                { state: "stopping", desc: "Transitioning toward stopped or sleeping." },
                { state: "stopped", desc: "Manually stopped. Snapshot flushed." },
                { state: "failed", desc: "Could not start or recover." },
                { state: "deleted", desc: "Permanently removed." },
              ].map(({ state, desc }, i, arr) => (
                <div key={state} className="docs-state-step">
                  <div className="docs-state-bubble">{state}</div>
                  {i < arr.length - 1 && <div className="docs-state-connector" />}
                  <p className="docs-state-desc muted">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h3>Access methods</h3>
                <p>Each session exposes multiple ways to interact with the running environment.</p>
              </div>
              <div className="stack">
                {[
                  {
                    method: "SSH",
                    detail: "Full native shell via WebSocket tunnel. Add your public key per-session.",
                    cmd: "flare session ssh <sessionId>",
                  },
                  {
                    method: "Browser preview",
                    detail: "HTTP proxy to your app's running port — shareable preview URL.",
                    cmd: "flare session preview <sessionId>",
                  },
                  {
                    method: "Editor / terminal",
                    detail: "Code-server or ttyd served in the browser — no local install needed.",
                    cmd: "flare session editor <sessionId>",
                  },
                ].map(({ method, detail, cmd }) => (
                  <div key={method} className="step">
                    <strong>{method}</strong>
                    <span>{detail}</span>
                    <pre className="code-block">{cmd}</pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="stack">
              <div className="card">
                <div className="card-head">
                  <h3>Auto-sleep</h3>
                  <p>
                    Sessions sleep automatically after the <code>sleepTtlSeconds</code> idle
                    threshold defined in the template manifest. The container goes dormant, a
                    snapshot is flushed, and the session wakes instantly when you call{" "}
                    <code>start</code> again.
                  </p>
                </div>
                <div className="surface-note">
                  <strong>State is preserved</strong>
                  <span>
                    Persisted paths are snapshotted before sleep and restored on wake — your work
                    is never lost between sessions.
                  </span>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>CLI quick reference</h3>
                </div>
                <div className="stack">
                  {[
                    { cmd: "flare session up sandbox --template <id>", desc: "Create and start a session." },
                    { cmd: "flare session start <id>", desc: "Start or wake a stopped session." },
                    { cmd: "flare session stop <id>", desc: "Flush snapshot and stop." },
                    { cmd: "flare session restart <id>", desc: "Restart a running session." },
                    { cmd: "flare session delete <id>", desc: "Permanently remove a session." },
                  ].map(({ cmd, desc }) => (
                    <div key={cmd} className="step">
                      <pre className="code-block">{cmd}</pre>
                      <span>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Snapshots */}
        <section id="snapshots" className="docs-section">
          <div className="card docs-concept-header">
            <div className="hero-topline">
              <span className="eyebrow">Snapshots</span>
            </div>
            <h2 className="docs-concept-title">Point-in-time state captures</h2>
            <p className="subtitle">
              A snapshot is a compressed archive of a session's persisted paths at a specific
              moment. Snapshots are created automatically on sleep and stop, and manually on
              demand. Restore any snapshot to roll a session back to that exact state.
            </p>
          </div>

          <div className="grid grid-3">
            <div className="metric-chip">
              <strong>Automatic</strong>
              <span>Created on every sleep and stop — no manual step needed for basic persistence.</span>
            </div>
            <div className="metric-chip">
              <strong>Manual</strong>
              <span>Trigger a snapshot at any time to checkpoint mid-session work.</span>
            </div>
            <div className="metric-chip">
              <strong>Restorable</strong>
              <span>Restore any snapshot to roll back or clone a working environment.</span>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h3>How snapshots work</h3>
              </div>
              <div className="quickstart-grid">
                <div className="step">
                  <strong>1. Paths are defined</strong>
                  <span>The template manifest's <code>persistedPaths</code> lists which directories are captured.</span>
                </div>
                <div className="step">
                  <strong>2. Snapshot is created</strong>
                  <span>Those paths are compressed into a <code>.tar.gz</code> archive and uploaded to object storage.</span>
                </div>
                <div className="step">
                  <strong>3. Session references it</strong>
                  <span>The session records the snapshot ID as its <code>lastRestoredSnapshotId</code>.</span>
                </div>
                <div className="step">
                  <strong>4. Restore on start</strong>
                  <span>When the session starts, the referenced snapshot is downloaded and extracted into place.</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>CLI quick reference</h3>
              </div>
              <div className="stack">
                {[
                  { cmd: "flare snapshot save <sessionId> --label checkpoint", desc: "Create a named snapshot." },
                  { cmd: "flare snapshot list <sessionId>", desc: "List all snapshots for a session." },
                  { cmd: "flare snapshot restore <sessionId> <snapshotId>", desc: "Restore a snapshot." },
                  { cmd: "flare snapshot get <sessionId> <snapshotId> --output ./backup.tar.gz", desc: "Download a snapshot locally." },
                  { cmd: "flare snapshot delete <sessionId> <snapshotId>", desc: "Remove a snapshot." },
                ].map(({ cmd, desc }) => (
                  <div key={cmd} className="step">
                    <pre className="code-block">{cmd}</pre>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Runtime secrets */}
        <section id="secrets" className="docs-section">
          <div className="grid grid-2">
            <div className="card docs-concept-header">
              <div className="hero-topline">
                <span className="eyebrow">Runtime secrets</span>
              </div>
              <h2 className="docs-concept-title">Workspace-wide environment variables</h2>
              <p className="subtitle">
                Runtime secrets are key-value pairs defined at the workspace level. Every session
                in the workspace receives them as environment variables at boot — no per-session
                configuration needed.
              </p>
              <div className="surface-note">
                <strong>Limits</strong>
                <span>Up to 32 secrets per workspace, each up to 4 KB. Stored encrypted and injected at container boot.</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Common uses</h3>
              </div>
              <div className="stack">
                {[
                  { name: "API keys", desc: "Inject third-party API keys without baking them into images." },
                  { name: "Database URLs", desc: "Share connection strings across all developer environments." },
                  { name: "Feature flags", desc: "Toggle behaviour across the whole team in one place." },
                  { name: "Registry credentials", desc: "Authenticate to private package registries at session start." },
                ].map(({ name, desc }) => (
                  <div key={name} className="docs-role-row">
                    <strong className="docs-badge-plain">{name}</strong>
                    <span className="muted">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Access & roles */}
        <section id="access" className="docs-section">
          <div className="card docs-concept-header">
            <div className="hero-topline">
              <span className="eyebrow">Access &amp; roles</span>
            </div>
            <h2 className="docs-concept-title">Auth, tokens, and SSH keys</h2>
            <p className="subtitle">
              BurstFlare uses a layered auth model: passkey or password login issues a browser
              session, the CLI exchanges a device code for long-lived tokens, and containers
              receive short-lived runtime tokens at boot.
            </p>
          </div>

          <div className="grid grid-3">
            <div className="card">
              <div className="card-head">
                <h3>Browser session</h3>
                <p>Standard login via email + passkey or recovery code. Session cookie valid for 30 days.</p>
              </div>
              <div className="surface-note">
                <strong>Passkeys</strong>
                <span>Biometric sign-in via WebAuthn — no password ever touches the server.</span>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>CLI tokens</h3>
                <p>
                  <code>flare auth login</code> opens a browser approval flow. On approval the CLI
                  receives a refresh token (30 days) and exchanges it for access tokens (7 days).
                </p>
              </div>
              <pre className="code-block">{`flare auth register --email you@example.com
flare auth login
flare auth status`}</pre>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>SSH keys</h3>
                <p>
                  Each session maintains its own list of authorized public keys. Add a key once and
                  it persists for the life of the session.
                </p>
              </div>
              <pre className="code-block">{`flare session ssh-key add <sessionId> \
  --key "$(cat ~/.ssh/id_ed25519.pub)"`}</pre>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="card docs-footer">
          <p className="muted">
            Ready to build?{" "}
            <a href="/" className="docs-link">
              Open BurstFlare →
            </a>
          </p>
        </div>
      </main>
    </>
  );
}

const docsStyles = `
.docs-header {
  display: grid;
  gap: 24px;
}

.docs-header-inner {
  display: grid;
  gap: 16px;
}

.docs-home-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 760;
  letter-spacing: 0.02em;
  color: var(--muted);
  text-decoration: none;
  padding: 6px 0;
  transition: color 0.18s ease;
}

.docs-home-link:hover {
  color: var(--accent);
}

.docs-hero-copy {
  display: grid;
  gap: 16px;
  max-width: 680px;
}

.docs-title {
  margin: 0;
  font-size: clamp(2.2rem, 5vw, 3.8rem);
  line-height: 1;
  letter-spacing: -0.055em;
  font-weight: 820;
}

.docs-toc {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.docs-toc-link {
  display: inline-flex;
  align-items: center;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.docs-toc-link:hover {
  background: rgba(180, 76, 35, 0.08);
  border-color: rgba(180, 76, 35, 0.2);
  color: var(--accent);
}

.docs-section {
  display: grid;
  gap: 18px;
}

.docs-overview {
  display: grid;
  gap: 28px;
}

.docs-diagram {
  display: grid;
  gap: 12px;
  justify-items: center;
}

.docs-diagram-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.docs-diagram-node {
  display: grid;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 22px;
  border: 1px solid var(--line-strong);
  background: rgba(255, 255, 255, 0.8);
  box-shadow: var(--shadow-soft);
  text-align: center;
  min-width: 140px;
}

.docs-diagram-node strong {
  font-size: 0.96rem;
  letter-spacing: -0.03em;
}

.docs-diagram-node span {
  font-size: 0.76rem;
  color: var(--muted);
}

.docs-diagram-root {
  border-color: rgba(180, 76, 35, 0.28);
  background: rgba(180, 76, 35, 0.06);
}

.docs-diagram-root strong {
  color: var(--accent);
}

.docs-diagram-arrow {
  font-size: 1.4rem;
  color: var(--muted);
}

.docs-diagram-connector {
  font-size: 0.78rem;
  color: var(--muted);
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.docs-concept-header {
  display: grid;
  gap: 14px;
}

.docs-concept-title {
  margin: 0;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  line-height: 1.05;
  letter-spacing: -0.05em;
  font-weight: 800;
}

.docs-table-wrap {
  overflow-x: auto;
  border-radius: 18px;
  border: 1px solid var(--line);
}

.docs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.docs-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.6);
  border-bottom: 1px solid var(--line);
}

.docs-table td {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(22, 33, 40, 0.05);
}

.docs-table tr:last-child td {
  border-bottom: none;
}

.docs-table td:first-child {
  font-weight: 680;
  color: var(--ink);
}

.docs-table td:not(:first-child) {
  color: var(--muted);
  text-align: right;
}

.docs-role-row,
.docs-field-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(22, 33, 40, 0.06);
}

.docs-role-row:last-child,
.docs-field-row:last-child {
  border-bottom: none;
}

.docs-badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 8px;
  background: rgba(180, 76, 35, 0.1);
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}

.docs-badge-plain {
  white-space: nowrap;
  flex-shrink: 0;
  font-size: 0.9rem;
  letter-spacing: -0.02em;
}

.docs-manifest-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.docs-state-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(22, 33, 40, 0.06);
}

.docs-state-row:last-child {
  border-bottom: none;
}

.docs-state-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 760;
  letter-spacing: 0.04em;
  white-space: nowrap;
  flex-shrink: 0;
}

.docs-state-neutral { background: rgba(22, 33, 40, 0.08); color: var(--muted); }
.docs-state-active  { background: rgba(22, 100, 200, 0.12); color: #1a5db5; }
.docs-state-danger  { background: rgba(200, 40, 40, 0.1); color: #b52020; }
.docs-state-ready   { background: rgba(30, 160, 90, 0.12); color: #1a8050; }
.docs-state-accent  { background: rgba(180, 76, 35, 0.12); color: var(--accent); }

.docs-states-flow {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0;
}

.docs-state-step {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-right: 1px solid var(--line);
  position: relative;
}

.docs-state-step:last-child {
  border-right: none;
}

.docs-state-bubble {
  display: inline-block;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(180, 76, 35, 0.1);
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 780;
  letter-spacing: 0.04em;
  width: fit-content;
}

.docs-state-connector {
  display: none;
}

.docs-state-desc {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
}

.docs-footer {
  text-align: center;
  padding: 28px;
}

.docs-footer p {
  margin: 0;
  font-size: 1rem;
}

.docs-link {
  color: var(--accent);
  font-weight: 760;
  text-decoration: none;
  transition: color 0.18s ease;
}

.docs-link:hover {
  color: var(--accent-deep);
}

@media (max-width: 860px) {
  .docs-diagram-row {
    flex-direction: column;
    align-items: center;
  }
  .docs-diagram-connector {
    transform: rotate(90deg);
  }
  .docs-states-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .docs-state-step:nth-child(even) {
    border-right: none;
  }
  .docs-state-step:nth-child(odd):not(:last-child) {
    border-right: 1px solid var(--line);
  }
}

@media (max-width: 540px) {
  .docs-states-flow {
    grid-template-columns: 1fr;
  }
  .docs-state-step {
    border-right: none;
    border-bottom: 1px solid var(--line);
  }
  .docs-state-step:last-child {
    border-bottom: none;
  }
}

.docs-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.docs-markdown-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(22, 33, 40, 0.05);
  font-size: 0.76rem;
  font-weight: 760;
  letter-spacing: 0.04em;
  color: var(--muted);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}

.docs-markdown-link:hover {
  background: rgba(22, 33, 40, 0.1);
  color: var(--ink);
  border-color: var(--line-strong);
}

.docs-markdown-icon {
  font-size: 0.9rem;
  opacity: 0.7;
}
`;
