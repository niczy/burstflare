export const metadata = {
  title: "BurstFlare",
  description:
    "BurstFlare keeps templates, sessions, previews, access flows, terminal tools, snapshots, and activity in one place."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
