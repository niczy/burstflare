import type { ReactNode } from "react";

export const metadata = {
  title: "BurstFlare",
  description:
    "BurstFlare keeps templates, sessions, previews, access flows, terminal tools, snapshots, and activity in one place."
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
