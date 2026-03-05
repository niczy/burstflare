import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Sign in - BurstFlare",
  description: "Sign in to BurstFlare."
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

        <section className="card stack" style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}>
            <div className="card-head">
              <h2 style={{ margin: 0 }}>Sign in with email</h2>
            </div>

            <div>
              <label htmlFor="email">Work email</label>
              <input id="email" type="email" placeholder="you@example.com" />
            </div>

            <div>
              <label>Verification challenge</label>
              <div className="surface-note" id="turnstileWidget">
                The verification challenge loads automatically when Turnstile is configured.
              </div>
            </div>

            <input id="turnstileToken" type="hidden" />

            <div className="row">
              <button id="loginButton">Send Sign-In Code</button>
              <button className="secondary" id="verifyEmailCodeButton" style={{ display: "none" }}>
                Verify Code
              </button>
            </div>

            <div id="emailCodeSection" style={{ display: "none" }}>
              <label htmlFor="emailCode">Verification code</label>
              <input id="emailCode" type="text" inputMode="numeric" placeholder="123456" />
            </div>

            <div className="surface-note" id="emailCodeStatus">
              Request a verification code, then enter it here to complete browser sign-in.
            </div>

            <div id="errors" className="error" />
          </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
