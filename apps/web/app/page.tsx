import { AppShell } from "./components/layout/app-shell.js";
import { Badge } from "./components/primitives/badge.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./components/primitives/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "./components/primitives/table.js";
import { getHealth } from "./lib/server/api.js";

export const metadata = {
  title: "BurstFlare",
  description:
    "Spin up ready-to-code cloud workspaces in minutes with shared instance state and per-session state that stays yours."
};

export default async function HomePage() {
  const health = await getHealth().catch(() => null);

  return (
    <AppShell active="home">
      <section className="hero-grid">
        <Card>
          <CardHeader>
            <Badge variant="accent">Vinext SSR</Badge>
            <CardTitle className="hero-title">
              Ship faster with reusable cloud workspaces.
            </CardTitle>
            <CardDescription className="hero-copy">
              Launch production-ready dev sessions in minutes, share one golden
              instance baseline with your team, and combine synced
              <code> /home/flare </code>
              state with each session&apos;s own local state for focused work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="info-grid">
              <div className="info-block">
                <strong>1. Create</strong>
                Start from a proven base image like <code>ubuntu:24.04</code> or
                <code> debian:12</code>.
              </div>
              <div className="info-block">
                <strong>2. Launch</strong>
                Launch one or many sessions that share the instance baseline.
              </div>
              <div className="info-block">
                <strong>3. Sync</strong>
                Sync shared <code>/home/flare</code> while each session keeps local
                changes.
              </div>
            </div>
            <div className="cta-row">
              <a className="nav-cta" href="/dashboard">
                Try the dashboard
              </a>
              <a className="nav-cta" href="/docs">
                Read docs
              </a>
              <a className="nav-cta" href="/login">
                Get started free
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quickstart</CardTitle>
            <CardDescription>
              CLI workflow with persistent session state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="code-panel">{`flare instance create node-dev --image ubuntu:24.04
flare session up sandbox --instance <instanceId>
flare ssh <sessionId>`}</pre>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead>Persistence model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <code>/home/flare</code>
                  </TableCell>
                  <TableCell>Shared at instance level</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Runtime availability</TableCell>
                  <TableCell>
                    {health?.runtime?.containersEnabled ? "Containers enabled" : "Runtime unavailable"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>SSR health check</TableCell>
                  <TableCell>{health?.ok ? "Healthy" : "Unavailable"}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>/workspace</code>
                  </TableCell>
                  <TableCell>Session-isolated, auto-restored</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
