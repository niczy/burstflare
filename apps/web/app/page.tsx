import { styles } from "../src/assets.js";
import { SiteNav, siteNavStyles } from "./components/site-nav.js";

export const metadata = {
  title: "BurstFlare",
  description: "Create an instance, launch a session, and share /home/flare state across restarts."
};

export default function HomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="home" />

        <section className="card stack" style={{ padding: 32 }}>
          <div className="card-head">
            <h1 style={{ margin: 0, fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1, letterSpacing: "-0.05em" }}>
              Instances first.
            </h1>
            <p style={{ maxWidth: 720 }}>
              BurstFlare is now centered on one loop: define an instance, launch sessions from it,
              and keep shared files in <code>/home/flare</code> without extra packaging steps.
            </p>
          </div>

          <div className="grid grid-3">
            <div className="surface-note">
              <strong>1. Create</strong>
              <span>Use a registry image or a Dockerfile source.</span>
            </div>
            <div className="surface-note">
              <strong>2. Launch</strong>
              <span>Start one or many sessions from the same instance.</span>
            </div>
            <div className="surface-note">
              <strong>3. Sync</strong>
              <span>Push and pull <code>/home/flare</code> between running sessions and object storage.</span>
            </div>
          </div>

          <pre className="code-block">{`flare instance create node-dev --image node:20
flare session up sandbox --instance <instance-id>
flare ssh <session-id>`}</pre>

          <div className="row">
            <a className="secondary" href="/dashboard" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Open dashboard
            </a>
            <a className="secondary" href="/docs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Read docs
            </a>
            <a href="/login" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Sign in
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
