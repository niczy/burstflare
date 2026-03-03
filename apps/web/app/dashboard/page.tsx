import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Dashboard - BurstFlare",
  description: "Manage instances, sessions, common state, and runtime health."
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

        <div className="card">
          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" id="refreshButton">Refresh</button>
          </div>
          <div id="errors" className="error" />
        </div>

        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Instances</h2>
              <p>Create reusable runtimes, then sync shared files in <code>/home/flare</code>.</p>
            </div>
            <div>
              <label htmlFor="instanceName">Instance name</label>
              <input id="instanceName" type="text" placeholder="node-dev" />
            </div>
            <div>
              <label htmlFor="instanceImage">Image</label>
              <input id="instanceImage" type="text" placeholder="node:20" />
            </div>
            <div>
              <label htmlFor="instanceDescription">Description</label>
              <textarea id="instanceDescription" placeholder="Base image for ad-hoc coding sessions" />
            </div>
            <button id="createInstanceButton">Create instance</button>

            <div className="row">
              <div>
                <label htmlFor="commonStateInstance">Common state instance</label>
                <select id="commonStateInstance" />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <button className="secondary" id="pushCommonStateButton">Push</button>
                <button className="secondary" id="pullCommonStateButton">Pull</button>
              </div>
            </div>

            <div className="list" id="instances" />
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Sessions</h2>
              <p>Launch a session from any instance, then start, stop, restart, or delete it.</p>
            </div>
            <div>
              <label htmlFor="sessionName">Session name</label>
              <input id="sessionName" type="text" placeholder="sandbox" />
            </div>
            <div>
              <label htmlFor="sessionInstance">Instance</label>
              <select id="sessionInstance" />
            </div>
            <button id="createSessionButton">Create and start</button>
            <div className="list" id="sessions" />
          </div>
        </section>

        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Usage</h2>
              <p>Runtime minutes and storage roll up here.</p>
            </div>
            <pre id="usage">{"{}"}</pre>
            <pre id="report">{"{}"}</pre>
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Activity</h2>
              <p>Recent audit entries from the simplified instance-first flow.</p>
            </div>
            <pre id="audit">{"[]"}</pre>
          </div>
        </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
