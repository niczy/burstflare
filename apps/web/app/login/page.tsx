import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Sign in - BurstFlare",
  description: "Request a verification code and sign in to BurstFlare."
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

        <section className="grid grid-2" style={{ alignItems: "stretch" }}>
          <section
            className="card stack"
            style={{
              minHeight: 420,
              background:
                "radial-gradient(circle at 84% 18%, rgba(180, 76, 35, 0.16), transparent 24%), linear-gradient(145deg, rgba(255, 253, 249, 0.96), rgba(255, 244, 234, 0.82))"
            }}
          >
            <div className="card-head" style={{ gap: 10 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.76rem",
                  fontWeight: 820,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent)"
                }}
              >
                One Step In
              </p>
              <h1 style={{ margin: 0, fontSize: "clamp(2.3rem, 4.8vw, 4.8rem)", lineHeight: 0.94, letterSpacing: "-0.06em" }}>
                Email unlocks your workspace.
              </h1>
              <p style={{ margin: 0, maxWidth: 36 * 16 }}>
                Ask for a six-digit code, confirm it once, and this browser is ready. First-time emails automatically
                create a workspace, so there is no separate signup step anymore.
              </p>
            </div>

            <div className="grid" style={{ gap: 14 }}>
              <div className="surface-note">
                <strong>1. Request</strong>
                <span>Pass the Turnstile check and send a short verification code to your inbox.</span>
              </div>
              <div className="surface-note">
                <strong>2. Confirm</strong>
                <span>Paste the code here to open the browser session and, when needed, finish pending CLI sign-ins.</span>
              </div>
              <div className="surface-note">
                <strong>3. Continue</strong>
                <span>Signed-in visits land in the dashboard automatically, including when you return to the homepage.</span>
              </div>
            </div>
          </section>

          <section className="card stack" style={{ maxWidth: 640, width: "100%", marginLeft: "auto" }}>
            <div className="card-head">
              <h2 style={{ margin: 0 }}>Sign in with email</h2>
              <p>Use one email field, one code field, and this browser will stay in sync with the rest of the site.</p>
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
              <button className="secondary" id="verifyEmailCodeButton">Verify Code</button>
            </div>

            <div>
              <label htmlFor="emailCode">Verification code</label>
              <input id="emailCode" type="text" inputMode="numeric" placeholder="123456" />
            </div>

            <div className="surface-note" id="emailCodeStatus">
              Request a verification code, then enter it here to complete browser sign-in.
            </div>

            <div className="row" style={{ alignItems: "center" }}>
              <div className="surface-note" style={{ flex: "1 1 260px", margin: 0 }}>
                <strong id="identity">Not signed in</strong>
                <span id="lastRefresh">Last refresh: never</span>
              </div>
              <button className="secondary" id="logoutButton" style={{ flex: "0 0 auto" }}>
                Sign out
              </button>
            </div>

            <div id="errors" className="error" />
          </section>
        </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
