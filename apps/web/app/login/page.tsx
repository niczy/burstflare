import { AppShell } from "../components/layout/app-shell.js";
import { LoginPanel } from "../components/domain/auth/login-panel.js";

export const metadata = {
  title: "Sign in - BurstFlare",
  description: "Sign in to BurstFlare."
};

const turnstileKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

export default function LoginPage() {
  return (
    <>
      {turnstileKey ? (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      ) : null}
      <AppShell active="login">
        <LoginPanel turnstileSiteKey={turnstileKey} />
      </AppShell>
    </>
  );
}
