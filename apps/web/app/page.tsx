import { styles } from "../src/assets.js";
import { SiteNav, siteNavStyles } from "./components/site-nav.js";

export const metadata = {
  title: "BurstFlare — Build once. Launch often.",
  description:
    "BurstFlare keeps templates, sessions, previews, access flows, terminal tools, snapshots, and activity in one place so teams can move from sign-in to a working environment without extra handoffs.",
};

export default function HomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <style dangerouslySetInnerHTML={{ __html: landingStyles }} />
      <main className="shell">
        <SiteNav active="home" />

        {/* Hero */}
        <section className="hero">
          <div className="hero-main">
            <div className="card hero-card">
              <div className="hero-topline">
                <span className="eyebrow">BurstFlare</span>
                <span className="pill">Now in preview</span>
              </div>
              <div className="hero-copy">
                <div className="section-shell">
                  <p className="section-kicker">Build once. Launch often.</p>
                  <h1 className="title">A real workspace&nbsp;hub.</h1>
                </div>
                <p className="subtitle">
                  BurstFlare keeps templates, sessions, previews, access flows, terminal tools,
                  snapshots, and activity in one place so teams move from sign-in to a working
                  environment without extra handoffs.
                </p>
              </div>
              <div className="hero-metrics">
                <div className="metric-chip">
                  <strong>Templates stay ready</strong>
                  <span>Version, promote, and roll back container environments without rebuilding your whole process.</span>
                </div>
                <div className="metric-chip">
                  <strong>Sessions stay close</strong>
                  <span>Preview, editor, terminal, and SSH all hang off the same workspace flow.</span>
                </div>
                <div className="metric-chip">
                  <strong>State is preserved</strong>
                  <span>Snapshots capture persisted paths on every sleep so no work is ever lost between sessions.</span>
                </div>
              </div>
              <div className="hero-actions">
                <a href="/login" className="landing-btn-primary">Get started free</a>
                <a href="/docs" className="landing-btn-secondary">Read the docs</a>
              </div>
            </div>

            <div className="hero-band">
              {/* Quickstart */}
              <div className="card quickstart-shell">
                <div className="card-head">
                  <h2>Quick start</h2>
                  <p>Open the product first. Bring in the CLI when you want repeatable setup.</p>
                </div>
                <div className="quickstart-grid">
                  <div className="step">
                    <strong>1. Create an account</strong>
                    <span>Register with your email or a passkey — no credit card required on the free plan.</span>
                    <a href="/login" className="landing-step-link">Open sign-in →</a>
                  </div>
                  <div className="step">
                    <strong>2. Install the CLI</strong>
                    <span><code>flare</code> points at <code>burstflare.dev</code> by default.</span>
                    <pre className="code-block">npm install -g @burstflare/flare
flare auth login</pre>
                  </div>
                  <div className="step">
                    <strong>3. Ship a template</strong>
                    <span>Define a container image, upload a bundle, promote the version.</span>
                    <pre className="code-block">flare template create node-dev
flare template upload &lt;id&gt; --version 1.0.0
flare template promote &lt;id&gt; &lt;versionId&gt;</pre>
                  </div>
                  <div className="step">
                    <strong>4. Launch a session</strong>
                    <span>Start an environment and jump straight into SSH or the browser editor.</span>
                    <pre className="code-block">flare session up sandbox --template &lt;id&gt;
flare session ssh &lt;sessionId&gt;</pre>
                  </div>
                </div>
              </div>

              {/* Concept map */}
              <div className="card landing-concepts">
                <div className="card-head">
                  <h2>How it fits together</h2>
                  <p>Four building blocks — each with its own page in the app.</p>
                </div>
                <div className="stack">
                  {[
                    {
                      label: "Workspaces",
                      desc: "Billing boundary, team members, and shared runtime secrets.",
                      href: "/docs#workspaces",
                    },
                    {
                      label: "Templates",
                      desc: "Versioned container specs. Promote once, launch many times.",
                      href: "/docs#templates",
                    },
                    {
                      label: "Sessions",
                      desc: "Live container instances with SSH, preview, and editor access.",
                      href: "/docs#sessions",
                    },
                    {
                      label: "Snapshots",
                      desc: "Point-in-time captures of persisted paths. Restored on next start.",
                      href: "/docs#snapshots",
                    },
                  ].map(({ label, desc, href }) => (
                    <a key={label} href={href} className="landing-concept-row">
                      <strong>{label}</strong>
                      <span className="muted">{desc}</span>
                      <span className="landing-concept-arrow">→</span>
                    </a>
                  ))}
                </div>
                <div className="landing-docs-cta">
                  <a href="/docs" className="landing-btn-secondary">Full documentation →</a>
                </div>
              </div>
            </div>
          </div>

          {/* Side panel — app links */}
          <aside className="card landing-side">
            <div className="card-head">
              <h2>Open the app</h2>
              <p>Pick where you want to go. Everything runs on the same account.</p>
            </div>

            <div className="stack">
              {[
                {
                  href: "/login",
                  label: "Sign in / Register",
                  desc: "Email, passkey, or recovery code.",
                  primary: true,
                },
                {
                  href: "/dashboard",
                  label: "Dashboard",
                  desc: "Templates, sessions, terminal, snapshots.",
                  primary: false,
                },
                {
                  href: "/profile",
                  label: "Profile & workspace",
                  desc: "Members, invites, devices, auth sessions.",
                  primary: false,
                },
                {
                  href: "/docs",
                  label: "Documentation",
                  desc: "Concepts, API reference, CLI guide.",
                  primary: false,
                },
              ].map(({ href, label, desc, primary }) => (
                <a key={href} href={href} className={`landing-app-link${primary ? " landing-app-link--primary" : ""}`}>
                  <strong>{label}</strong>
                  <span>{desc}</span>
                </a>
              ))}
            </div>

            <div className="surface-note">
              <strong>Free plan</strong>
              <span>
                10 templates · 3 running sessions · 25 MB storage · 500 runtime minutes per month.
                No card required.
              </span>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}

const landingStyles = `
.landing-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 22px;
  border-radius: 17px;
  font-size: 0.92rem;
  font-weight: 760;
  letter-spacing: -0.01em;
  color: #fff7f2;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  text-decoration: none;
  box-shadow: 0 14px 28px rgba(180, 76, 35, 0.2);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.landing-btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 34px rgba(180, 76, 35, 0.26);
}

.landing-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 22px;
  border-radius: 17px;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid var(--line);
  text-decoration: none;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.landing-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.96);
  border-color: var(--line-strong);
}

.landing-step-link {
  font-size: 0.82rem;
  font-weight: 760;
  color: var(--accent);
  text-decoration: none;
}

.landing-step-link:hover {
  color: var(--accent-deep);
}

.landing-concepts {
  display: grid;
  gap: 18px;
}

.landing-concept-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px 12px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(22, 33, 40, 0.07);
  background: rgba(255, 255, 255, 0.6);
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.landing-concept-row:hover {
  background: rgba(180, 76, 35, 0.05);
  border-color: rgba(180, 76, 35, 0.15);
}

.landing-concept-row strong {
  font-size: 0.92rem;
  letter-spacing: -0.02em;
  color: var(--ink);
  grid-row: 1;
}

.landing-concept-row span.muted {
  font-size: 0.8rem;
  grid-row: 2;
}

.landing-concept-arrow {
  grid-row: 1 / 3;
  align-self: center;
  color: var(--muted);
  font-size: 1rem;
}

.landing-docs-cta {
  padding-top: 4px;
}

.landing-side {
  position: sticky;
  top: 18px;
  display: grid;
  gap: 18px;
}

.landing-app-link {
  display: grid;
  gap: 5px;
  padding: 14px 16px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.landing-app-link:hover {
  background: rgba(255, 255, 255, 0.92);
  border-color: var(--line-strong);
  transform: translateY(-1px);
}

.landing-app-link--primary {
  background: linear-gradient(135deg, rgba(180, 76, 35, 0.06), rgba(180, 76, 35, 0.02));
  border-color: rgba(180, 76, 35, 0.2);
}

.landing-app-link--primary:hover {
  background: linear-gradient(135deg, rgba(180, 76, 35, 0.1), rgba(180, 76, 35, 0.04));
  border-color: rgba(180, 76, 35, 0.3);
}

.landing-app-link strong {
  font-size: 0.96rem;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.landing-app-link span {
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
}
`;
