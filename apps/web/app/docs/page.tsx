import { AppShell } from "../components/layout/app-shell.js";
import { Badge } from "../components/primitives/badge.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../components/primitives/card.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/primitives/table.js";

export const metadata = {
  title: "Docs - BurstFlare",
  description: "Learn the instance, session, snapshot, and common-state model."
};

const concepts = [
  {
    title: "Instances",
    body:
      "Reusable runtime definitions with image choice, bootstrap script, environment, secrets, persisted paths, and shared home-state metadata."
  },
  {
    title: "Sessions",
    body:
      "Containers launched from an instance. Each session gets its own isolated /workspace so work stays local to that run."
  },
  {
    title: "Snapshots",
    body:
      "The latest session snapshot is restored on start so session-local files come back automatically without extra manual sync."
  },
  {
    title: "Common state",
    body:
      "/home/flare is shared per instance. BurstFlare restores it on start and syncs it back on stop, with explicit push and pull still available."
  }
];

const commands = `flare instance create node-dev --image ubuntu:24.04 --bootstrap-file ./bootstrap.sh
flare session up sandbox --instance <instance-id>
flare ssh <session-id>
flare instance push <instance-id>
flare instance pull <instance-id>`;

export default function DocsPage() {
  return (
    <AppShell active="docs">
      <section className="hero-grid">
        <Card>
          <CardHeader>
            <Badge variant="accent">Docs</Badge>
            <CardTitle className="hero-title">
              Understand the storage model before you launch a session.
            </CardTitle>
            <CardDescription className="hero-copy">
              BurstFlare separates reusable instance state from per-session state
              so teams can keep one stable baseline while each session stays
              isolated where it should.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="info-grid">
              {concepts.map((concept) => (
                <div key={concept.title} className="info-block">
                  <strong>{concept.title}</strong>
                  {concept.body}
                </div>
              ))}
            </div>
            <div className="cta-row">
              <a className="nav-cta" href="/dashboard">
                Open dashboard
              </a>
              <a className="nav-cta" href="/login">
                Create account
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quickstart</CardTitle>
            <CardDescription>
              Standard CLI flow for creating an instance, starting a session, and
              attaching over SSH.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <pre className="code-panel">{commands}</pre>
            <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
              Use an image your worker supports. Session startup will restore the
              shared instance state and the session&apos;s isolated workspace before
              you connect.
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="dashboard-stack">
        <Card>
          <CardHeader>
            <CardTitle>Persistence model</CardTitle>
            <CardDescription>
              What survives across starts, stops, and separate sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="table-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Path or object</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Behavior</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <code>/home/flare</code>
                    </TableCell>
                    <TableCell>Instance</TableCell>
                    <TableCell>Shared baseline synced across sessions of the same instance.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <code>/workspace</code>
                    </TableCell>
                    <TableCell>Session</TableCell>
                    <TableCell>Isolated per session and restored automatically when that session starts again.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Bootstrap script</TableCell>
                    <TableCell>Instance start</TableCell>
                    <TableCell>Runs on session start so dependencies and setup are rebuilt in ephemeral containers.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Snapshot</TableCell>
                    <TableCell>Latest session state</TableCell>
                    <TableCell>Captured for restart and preview flows without exposing raw storage mechanics.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
