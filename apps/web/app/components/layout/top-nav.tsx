type NavItem = {
  href: string;
  label: string;
};

const navItems: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
  { href: "/profile", label: "Profile" }
];

type TopNavProps = {
  active?: string;
};

export function TopNav({ active = "home" }: TopNavProps) {
  return (
    <header className="site-header">
      <a className="brand" href="/">
        BurstFlare
      </a>
      <nav className="nav-links" aria-label="Main navigation">
        {navItems.map((item) => {
          const isActive =
            (active === "home" && item.href === "/") ||
            item.href === `/${active}`;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="nav-actions">
        <a className="nav-cta" href="/login">
          Sign in
        </a>
      </div>
    </header>
  );
}
