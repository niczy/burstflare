import { styles } from "../../src/assets.js";
import { SiteNav, siteNavStyles } from "../components/site-nav.js";
import { getAppScript } from "../lib/app-script.js";

export const metadata = {
  title: "Billing - BurstFlare",
  description: "Manage payment methods, view usage, and download invoices."
};

const turnstileKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
  process.env.TURNSTILE_SITE_KEY ||
  "";

export default function BillingPage() {
  const appScript = getAppScript(turnstileKey);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <style dangerouslySetInnerHTML={{ __html: siteNavStyles }} />
      <main className="shell">
        <SiteNav active="billing" />

        <div className="card">
          <div className="surface-note">
            <strong id="identity">Not signed in</strong>
            <span id="lastRefresh">Last refresh: never</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" id="refreshProfileButton">Refresh</button>
          </div>
          <div id="errors" className="error" />
        </div>

        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Plan</h2>
              <p>Your current plan and usage limits.</p>
            </div>
            <div className="billing-plan-badge" id="billingPlanBadge">
              <span className="billing-plan-name" id="billingPlanName">Free</span>
            </div>
            <div className="billing-limits" id="billingLimits" />
            <div className="row">
              <button id="planButton">Upgrade to Pro</button>
            </div>
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Payment method</h2>
              <p>Add or update your payment method via Stripe.</p>
            </div>
            <div id="billingPaymentMethod" className="surface-note">
              <span className="muted">No payment method on file.</span>
            </div>
            <div className="row">
              <button id="addPaymentMethodButton">Add payment method</button>
              <button className="secondary" id="manageBillingButton">Manage billing</button>
            </div>
          </div>
        </section>

        <section className="grid grid-2">
          <div className="card stack">
            <div className="card-head">
              <h2>Current usage</h2>
              <p>Runtime minutes and storage consumed this period.</p>
            </div>
            <div className="billing-usage-meters" id="billingUsageMeters" />
            <div className="billing-usage-cost" id="billingUsageCost" />
          </div>

          <div className="card stack">
            <div className="card-head">
              <h2>Invoice</h2>
              <p>Generate an invoice for unbilled usage or view your last invoice.</p>
            </div>
            <div id="billingInvoiceInfo" className="surface-note">
              <span className="muted">No invoices yet.</span>
            </div>
            <div className="row">
              <button id="generateInvoiceButton" className="secondary">Generate invoice</button>
            </div>
          </div>
        </section>

        <section className="grid grid-1">
          <div className="card stack">
            <div className="card-head">
              <h2>Credit balance</h2>
              <p>Prepaid credits applied to future invoices.</p>
            </div>
            <div className="billing-balance" id="billingBalance">
              <span className="billing-balance-amount">$0.00</span>
            </div>
          </div>
        </section>
      </main>

      <script type="module" dangerouslySetInnerHTML={{ __html: appScript }} />
    </>
  );
}
