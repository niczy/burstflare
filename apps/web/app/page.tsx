import { appJs, html, styles } from "../src/assets.js";

const shellMarkupMatch = html.match(/<main class="shell">[\s\S]*<\/main>/);
const shellMarkup = shellMarkupMatch ? shellMarkupMatch[0] : "";
const turnstileKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || "";
const inlineAppJs = appJs.replace(
  "__BURSTFLARE_TURNSTILE_SITE_KEY__",
  JSON.stringify(turnstileKey)
);

export default function HomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      {turnstileKey ? (
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      ) : null}
      <div dangerouslySetInnerHTML={{ __html: shellMarkup }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: inlineAppJs }} />
    </>
  );
}
