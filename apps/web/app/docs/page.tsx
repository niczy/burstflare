import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Docs - BurstFlare",
  description: "Learn the instance, session, snapshot, and common-state model."
};

export default function DocsPage() {
  const turnstileKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    process.env.TURNSTILE_SITE_KEY ||
    "";
  const appScript = getAppScript(turnstileKey);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="docs" />

        <section className="card stack">
          <div className="card-head">
            <h1>Instance model</h1>
            <p>BurstFlare now has four core ideas: auth, instances, sessions, and storage.</p>
          </div>

          <div className="grid grid-2">
            <div className="surface-note">
              <strong>Instances</strong>
              <span>Reusable runtime definitions: image, env, secrets, startup bootstrap script, persisted paths, and shared home-state metadata.</span>
            </div>
            <div className="surface-note">
              <strong>Sessions</strong>
              <span>Running containers launched from an instance. Each session has isolated <code>/workspace</code>.</span>
            </div>
            <div className="surface-note">
              <strong>Snapshots</strong>
              <span>Each session keeps one latest snapshot that is restored automatically on start.</span>
            </div>
            <div className="surface-note">
              <strong>Common state</strong>
              <span><code>/home/flare</code> is shared per instance via pull-on-start, auto-push on stop, and explicit push/pull.</span>
            </div>
          </div>

          <pre className="code-block">{`flare instance create node-dev --image node:20 --bootstrap-file ./bootstrap.sh
flare session up sandbox --instance <instance-id>
flare instance push <instance-id>
flare instance pull <instance-id>`}</pre>
        </section>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
