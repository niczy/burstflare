import type { ReactNode } from "react";

export const metadata = {
  title: "BurstFlare",
  description:
    "BurstFlare keeps instances, sessions, previews, shared home state, and billing in one place."
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
