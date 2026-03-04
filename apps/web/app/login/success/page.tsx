import { styles } from "../../../src/assets.js";
import { SiteNav, siteNavStyles } from "../../components/site-nav.js";

export const metadata = {
  title: "Signed in - BurstFlare",
  description: "You have successfully signed in to BurstFlare."
};

export default function LoginSuccessPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="login" />

        <section className="grid" style={{ justifyContent: "center", padding: "60px 0" }}>
          <section
            className="card stack"
            style={{
              maxWidth: 520,
              width: "100%",
              textAlign: "center",
              background:
                "radial-gradient(circle at 80% 20%, rgba(34, 197, 94, 0.12), transparent 30%), linear-gradient(145deg, rgba(255, 253, 249, 0.97), rgba(240, 253, 244, 0.88))"
            }}
          >
            <div className="card-head" style={{ gap: 12, alignItems: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: "rgba(34, 197, 94, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto",
                  fontSize: "1.8rem"
                }}
              >
                &#10003;
              </div>
              <h1 style={{ margin: 0, fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", lineHeight: 1.1, letterSpacing: "-0.04em" }}>
                You&rsquo;re signed in!
              </h1>
              <p style={{ margin: 0, color: "var(--muted, #6b7280)" }}>
                Your CLI is now authenticated. You can close this tab and return to your terminal.
              </p>
            </div>

            <div className="surface-note" style={{ textAlign: "left" }}>
              <strong>What&rsquo;s next?</strong>
              <span>Your terminal should continue automatically. If it&rsquo;s still waiting, press Enter or paste the device code shown in this browser.</span>
            </div>

            <div style={{ paddingTop: 8 }}>
              <a href="/dashboard" className="button" style={{ display: "inline-block" }}>
                Go to dashboard
              </a>
            </div>
          </section>
        </section>
      </main>
    </>
  );
}
