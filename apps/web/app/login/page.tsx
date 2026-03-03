import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Sign in — BurstFlare",
  description: "Sign in or create a BurstFlare account.",
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
      <style dangerouslySetInnerHTML={{ __html: loginStyles }} />
      {turnstileKey ? (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      ) : null}
      <main className="shell">
        <SiteNav active="login" />

        <div className="login-layout">
          {/* Auth form */}
          <div className="card login-card">
            <div className="card-head">
              <h1 className="login-title">Sign in to BurstFlare</h1>
              <p>Use your email, passkey, or a recovery code.</p>
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
              <div
                className="turnstile-shell muted"
                id="turnstileWidget"
              >
                The verification challenge loads automatically in the hosted app.
              </div>
            </div>

            <div>
              <label htmlFor="turnstileToken">Verification token</label>
              <input
                id="turnstileToken"
                type="text"
                placeholder="Leave blank unless you are testing locally"
              />
            </div>

            <div className="row">
              <button id="registerButton">Register</button>
              <button className="secondary" id="loginButton">
                Login
              </button>
              <button className="secondary" id="passkeyLoginButton">
                Sign in with passkey
              </button>
            </div>

            <div className="login-divider" />

            <div>
              <label htmlFor="recoveryCode">Recovery code</label>
              <input
                id="recoveryCode"
                type="text"
                placeholder="recovery_..."
              />
            </div>
            <div className="row">
              <button className="secondary" id="recoverButton">
                Use recovery code
              </button>
              <button className="secondary" id="logoutButton">
                Logout
              </button>
            </div>

            <div id="errors" className="error" />
          </div>

          {/* Account status */}
          <div className="card login-status">
            <div className="card-head">
              <h2>Account</h2>
              <p>Your current session and security settings.</p>
            </div>

            <div className="surface-note">
              <strong id="identity">Not signed in</strong>
              <span id="lastRefresh">Last refresh: never</span>
            </div>

            <div className="stack">
              <div>
                <label>Passkeys</label>
                <div className="list" id="passkeys" />
              </div>

              <div className="row">
                <button className="secondary" id="recoveryCodesButton">
                  New recovery codes
                </button>
                <button className="secondary" id="passkeyRegisterButton">
                  Register passkey
                </button>
              </div>

              <div>
                <label>Recovery codes</label>
                <pre className="code-block" id="recoveryCodes">
                  No recovery codes generated.
                </pre>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden stubs for elements the global appJs references on other pages */}
      <div style={{ display: "none" }} aria-hidden="true">
        <div id="workspaceName" />
        <div id="deviceStatus" />
      </div>

      <script
        type="module"
        dangerouslySetInnerHTML={{ __html: appScript }}
      />
    </>
  );
}

const loginStyles = `
.login-layout {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
  align-items: start;
}

.login-title {
  margin: 0;
  font-size: clamp(1.5rem, 2.5vw, 2rem);
  line-height: 1.08;
  letter-spacing: -0.045em;
  font-weight: 800;
}

.login-card,
.login-status {
  display: grid;
  gap: 16px;
}

.login-divider {
  height: 1px;
  background: var(--line);
  margin: 4px 0;
}

.error {
  color: #b52020;
  font-size: 0.86rem;
  min-height: 1em;
}

@media (max-width: 720px) {
  .login-layout {
    grid-template-columns: 1fr;
  }
}
`;
