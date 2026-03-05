import type { ReactNode } from "react";
import { TopNav } from "./top-nav.js";

type AppShellProps = {
  active?: string;
  children: ReactNode;
};

export function AppShell({ active = "home", children }: AppShellProps) {
  return (
    <main className="page-shell">
      <TopNav active={active} />
      {children}
    </main>
  );
}
