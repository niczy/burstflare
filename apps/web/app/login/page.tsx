import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Sign in - BurstFlare",
  description: "Register, sign in, recover access, or sign out."
};

const turnstileKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

export default function LoginPage() {
  const appScript = getAppScript(turnstileKey);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      {turnstileKey ? (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      ) : null}
      <main className="shell">
        <SiteNav active="login" />

        <section className="card stack" style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="card-head">
            <h1 style={{ margin: 0 }}>Sign in</h1>
            <p>Use email for registration, browser login, recovery, or logout.</p>
          </div>

          <div className="row">
            <div>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" placeholder="you@example.com" />
            </div>
            <div>
              <label htmlFor="name">Name</label>
              <input id="name" type="text" placeholder="Your name" />
            </div>
          </div>

          <div>
            <label>Verification challenge</label>
            <div className="surface-note" id="turnstileWidget">
              The verification challenge loads automatically when Turnstile is configured.
            </div>
          </div>

          <div>
            <label htmlFor="turnstileToken">Verification token</label>
            <input id="turnstileToken" type="text" placeholder="Only needed for local testing." />
          </div>

          <div className="row">
            <button id="registerButton">Register</button>
            <button className="secondary" id="loginButton">Login</button>
            <button className="secondary" id="logoutButton">Logout</button>
          </div>

          <div>
            <label htmlFor="recoveryCode">Recovery code</label>
            <input id="recoveryCode" type="text" placeholder="recovery_..." />
          </div>
          <button className="secondary" id="recoverButton">Use recovery code</button>

          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div id="errors" className="error" />
        </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
