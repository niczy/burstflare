type Page = "home" | "login" | "dashboard" | "billing" | "profile" | "docs";

export function SiteNav({ active }: { active?: Page }) {
  return (
    <nav className="site-nav">
      <a href="/" className="site-nav-logo">
        <span className="site-nav-wordmark">BurstFlare</span>
      </a>
      <div className="site-nav-links">
        <span className="site-nav-session" id="navSessionState">Guest mode</span>
        <a
          id="navDashboardLink"
          href="/dashboard"
          className={`site-nav-link${active === "dashboard" ? " site-nav-link--active" : ""}`}
        >
          Dashboard
        </a>
        <a
          id="navBillingLink"
          href="/billing"
          className={`site-nav-link${active === "billing" ? " site-nav-link--active" : ""}`}
        >
          Billing
        </a>
        <a
          id="navProfileLink"
          href="/profile"
          className={`site-nav-link${active === "profile" ? " site-nav-link--active" : ""}`}
        >
          Profile
        </a>
        <a href="/docs" className={`site-nav-link${active === "docs" ? " site-nav-link--active" : ""}`}>
          Docs
        </a>
        <a
          id="navPrimaryCta"
          href="/login"
          className={`site-nav-cta${active === "login" ? " site-nav-link--active" : ""}`}
        >
          Sign in
        </a>
      </div>
    </nav>
  );
}

export const siteNavStyles = `
.site-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-radius: 26px;
  border: 1px solid var(--line);
  background: rgba(255, 252, 248, 0.88);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-soft);
}

.site-nav-logo {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 10px;
}

.site-nav-wordmark {
  font-size: 1.05rem;
  font-weight: 820;
  letter-spacing: -0.04em;
  color: var(--ink);
}

.site-nav-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.site-nav-session {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(22, 33, 40, 0.08);
  background: rgba(255, 255, 255, 0.54);
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 760;
  letter-spacing: 0.02em;
}

.site-nav-link {
  display: inline-flex;
  align-items: center;
  padding: 7px 13px;
  border-radius: 14px;
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--muted);
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.site-nav-link:hover,
.site-nav-link--active {
  background: rgba(22, 33, 40, 0.07);
  color: var(--ink);
}

.site-nav-cta {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border-radius: 14px;
  font-size: 0.84rem;
  font-weight: 760;
  letter-spacing: -0.01em;
  color: #fff7f2;
  background: linear-gradient(135deg, var(--accent), var(--accent-deep));
  text-decoration: none;
  box-shadow: 0 6px 16px rgba(180, 76, 35, 0.22);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.site-nav-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(180, 76, 35, 0.26);
}

@media (max-width: 540px) {
  .site-nav-session,
  .site-nav-link { display: none; }
}
`;
