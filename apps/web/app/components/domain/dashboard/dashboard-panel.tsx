"use client";

import { useMemo, useState } from "react";
import { Badge } from "../../primitives/badge.js";
import { Button } from "../../primitives/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../primitives/card.js";
import { Input } from "../../primitives/input.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../primitives/table.js";
import { clientApiJson } from "../../../lib/client/api.js";
import type {
  AdminReport,
  AdminReportResponse,
  AuditRecord,
  AuditResponse,
  DashboardSnapshot,
  InstanceRecord,
  InstancesResponse,
  SessionRecord,
  SessionsResponse,
  UsageResponse,
  Viewer
} from "../../../lib/types.js";

type DashboardPanelProps = {
  initialSnapshot: DashboardSnapshot;
};

const EMPTY_USAGE_TOTALS = {
  runtimeMinutes: 0,
  storageGbDays: 0,
  storageGbMonths: 0,
  currentStorageBytes: 0,
  currentStorageGb: 0
};

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    return String((error as { error: unknown }).error || "Request failed");
  }
  return error instanceof Error ? error.message : "Request failed";
}

function pickExistingOrFirst(items: Array<{ id: string }>, current: string): string {
  if (current && items.some((item) => item.id === current)) {
    return current;
  }
  return items[0]?.id || "";
}

function formatBytes(value: number | undefined | null): string {
  const bytes = Number.isFinite(value) ? Number(value) : 0;
  if (bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = bytes;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  const rounded = next >= 10 || index === 0 ? next.toFixed(0) : next.toFixed(1);
  return `${rounded} ${units[index]}`;
}

function formatNumber(value: number | undefined | null): string {
  const count = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(count);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
  return parsed.toLocaleString();
}

function percent(value: number, max: number | null | undefined): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || !max || max <= 0) {
    return 0;
  }
  const raw = (value / max) * 100;
  if (raw < 0) {
    return 0;
  }
  if (raw > 100) {
    return 100;
  }
  return Number(raw.toFixed(1));
}

function usageTotals(usage: UsageResponse | null) {
  return usage?.usage || EMPTY_USAGE_TOTALS;
}

function instanceImage(instance: InstanceRecord): string {
  return instance.baseImage || instance.image || "-";
}

function sessionPrimaryAction(session: SessionRecord): "start" | "stop" {
  return session.state === "running" ? "stop" : "start";
}

export function DashboardPanel({ initialSnapshot }: DashboardPanelProps) {
  const [viewer, setViewer] = useState<Viewer | null>(initialSnapshot.viewer);
  const [instances, setInstances] = useState<InstanceRecord[]>(initialSnapshot.instances);
  const [sessions, setSessions] = useState<SessionRecord[]>(initialSnapshot.sessions);
  const [usage, setUsage] = useState<UsageResponse | null>(initialSnapshot.usage);
  const [report, setReport] = useState<AdminReport | null>(initialSnapshot.report);
  const [audit, setAudit] = useState<AuditRecord[]>(initialSnapshot.audit);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(initialSnapshot.lastRefreshedAt);
  const [warning, setWarning] = useState<string>(initialSnapshot.warning || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const [instanceName, setInstanceName] = useState("");
  const [instanceImageValue, setInstanceImageValue] = useState("ubuntu:24.04");
  const [instanceDescription, setInstanceDescription] = useState("");
  const [sessionName, setSessionName] = useState("sandbox");
  const [sessionInstanceId, setSessionInstanceId] = useState(initialSnapshot.instances[0]?.id || "");
  const [commonStateInstanceId, setCommonStateInstanceId] = useState(initialSnapshot.instances[0]?.id || "");

  const isSignedIn = Boolean(viewer?.user?.email);
  const identityLabel = useMemo(() => {
    if (!viewer?.user?.email) {
      return "Not signed in";
    }
    const role = viewer.membership?.role ? ` (${viewer.membership.role})` : "";
    return `${viewer.user.email}${role}`;
  }, [viewer]);

  const totals = usageTotals(usage);
  const runtimeLimit = usage?.limits?.maxRuntimeMinutes || report?.limits?.maxRuntimeMinutes || null;
  const storageLimitBytes = usage?.limits?.maxStorageBytes || report?.limits?.maxStorageBytes || null;
  const runtimePct = percent(totals.runtimeMinutes, runtimeLimit);
  const storagePct = percent(totals.currentStorageBytes, storageLimitBytes);

  async function refreshDashboard(): Promise<void> {
    setPending(true);
    setError("");
    setWarning("");
    try {
      const nextViewer = await clientApiJson<Viewer>("/api/auth/me");
      setViewer(nextViewer);

      const [instancesResult, sessionsResult, usageResult, reportResult, auditResult] = await Promise.allSettled([
        clientApiJson<InstancesResponse>("/api/instances"),
        clientApiJson<SessionsResponse>("/api/sessions"),
        clientApiJson<UsageResponse>("/api/usage"),
        clientApiJson<AdminReportResponse>("/api/admin/report"),
        clientApiJson<AuditResponse>("/api/audit")
      ]);

      const warnings: string[] = [];

      const nextInstances =
        instancesResult.status === "fulfilled" && Array.isArray(instancesResult.value.instances)
          ? instancesResult.value.instances
          : [];
      if (instancesResult.status === "rejected") {
        warnings.push("instances");
      }
      setInstances(nextInstances);
      setSessionInstanceId((current) => pickExistingOrFirst(nextInstances, current));
      setCommonStateInstanceId((current) => pickExistingOrFirst(nextInstances, current));

      const nextSessions =
        sessionsResult.status === "fulfilled" && Array.isArray(sessionsResult.value.sessions)
          ? sessionsResult.value.sessions
          : [];
      if (sessionsResult.status === "rejected") {
        warnings.push("sessions");
      }
      setSessions(nextSessions);

      const nextUsage = usageResult.status === "fulfilled" ? usageResult.value : null;
      if (usageResult.status === "rejected") {
        warnings.push("usage");
      }
      setUsage(nextUsage);

      const nextReport = reportResult.status === "fulfilled" ? reportResult.value.report : null;
      if (reportResult.status === "rejected") {
        warnings.push("report");
      }
      setReport(nextReport);

      const nextAudit =
        auditResult.status === "fulfilled" && Array.isArray(auditResult.value.audit)
          ? auditResult.value.audit
          : [];
      if (auditResult.status === "rejected") {
        warnings.push("activity");
      }
      setAudit(nextAudit);

      setLastRefreshedAt(new Date().toISOString());
      if (warnings.length > 0) {
        setWarning(`Some sections could not be loaded: ${warnings.join(", ")}.`);
      }
    } catch (refreshError) {
      const status =
        refreshError && typeof refreshError === "object" && "status" in refreshError
          ? Number((refreshError as { status?: unknown }).status)
          : null;
      if (status === 401) {
        setViewer(null);
        setInstances([]);
        setSessions([]);
        setUsage(null);
        setReport(null);
        setAudit([]);
        setWarning("Sign in to manage instances, sessions, and usage.");
      } else {
        setError(normalizeError(refreshError));
      }
    } finally {
      setPending(false);
    }
  }

  async function runAction(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setError("");
    try {
      await action();
      await refreshDashboard();
    } catch (actionError) {
      setError(normalizeError(actionError));
      setPending(false);
    }
  }

  async function createInstance(): Promise<void> {
    const name = instanceName.trim();
    const image = instanceImageValue.trim() || "ubuntu:24.04";
    if (!name) {
      setError("Instance name is required.");
      return;
    }
    await runAction(async () => {
      await clientApiJson<{ instance: InstanceRecord }>("/api/instances", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          name,
          description: instanceDescription.trim(),
          image,
          baseImage: image
        })
      });
      setInstanceName("");
      setInstanceDescription("");
    });
  }

  async function syncCommonState(instanceId: string, direction: "push" | "pull"): Promise<void> {
    if (!instanceId) {
      setError("Select an instance first.");
      return;
    }
    await runAction(async () => {
      await clientApiJson(`/api/instances/${instanceId}/${direction}`, {
        method: "POST"
      });
    });
  }

  async function deleteInstance(instanceId: string): Promise<void> {
    await runAction(async () => {
      await clientApiJson(`/api/instances/${instanceId}`, {
        method: "DELETE"
      });
    });
  }

  async function createSession(): Promise<void> {
    const name = sessionName.trim();
    if (!name) {
      setError("Session name is required.");
      return;
    }
    if (!sessionInstanceId) {
      setError("Select an instance for the session.");
      return;
    }
    await runAction(async () => {
      const created = await clientApiJson<{ session: SessionRecord }>("/api/sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          name,
          instanceId: sessionInstanceId
        })
      });
      if (created.session?.id) {
        await clientApiJson(`/api/sessions/${created.session.id}/start`, {
          method: "POST"
        });
      }
      setSessionName("sandbox");
    });
  }

  async function transitionSession(sessionId: string, action: "start" | "stop" | "restart" | "delete"): Promise<void> {
    await runAction(async () => {
      if (action === "delete") {
        await clientApiJson(`/api/sessions/${sessionId}`, {
          method: "DELETE"
        });
        return;
      }
      await clientApiJson(`/api/sessions/${sessionId}/${action}`, {
        method: "POST"
      });
    });
  }

  return (
    <section className="dashboard-stack">
      <Card>
        <CardHeader>
          <CardTitle className="section-title">Dashboard</CardTitle>
          <CardDescription className="section-copy">{identityLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="dashboard-toolbar">
            <Button variant="secondary" onClick={refreshDashboard} disabled={pending}>
              Refresh
            </Button>
            <span className="dashboard-copy">Last refresh: {formatDate(lastRefreshedAt)}</span>
          </div>
          {warning ? <div className="status-box">{warning}</div> : null}
          {error ? <div className="error-box">{error}</div> : null}
        </CardContent>
      </Card>

      <div className="dashboard-grid">
        <Card>
          <CardHeader>
            <CardTitle>Instances</CardTitle>
            <CardDescription>
              Reusable runtime definitions with shared <code>/home/flare</code> common state.
            </CardDescription>
          </CardHeader>
          <CardContent className="panel-stack">
            <div className="dashboard-form">
              <div className="dashboard-field">
                <label htmlFor="instanceName">Instance name</label>
                <Input
                  id="instanceName"
                  placeholder="node-dev"
                  value={instanceName}
                  disabled={pending || !isSignedIn}
                  onChange={(event) => setInstanceName(event.target.value)}
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="instanceImage">Image</label>
                <Input
                  id="instanceImage"
                  placeholder="ubuntu:24.04"
                  value={instanceImageValue}
                  disabled={pending || !isSignedIn}
                  onChange={(event) => setInstanceImageValue(event.target.value)}
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="instanceDescription">Description</label>
                <textarea
                  id="instanceDescription"
                  className="dashboard-textarea"
                  placeholder="Base image for ad-hoc coding sessions"
                  value={instanceDescription}
                  disabled={pending || !isSignedIn}
                  onChange={(event) => setInstanceDescription(event.target.value)}
                />
              </div>
              <div className="inline-actions">
                <Button onClick={createInstance} disabled={pending || !isSignedIn}>
                  Create instance
                </Button>
              </div>
            </div>

            <div className="dashboard-row">
              <div className="dashboard-field">
                <label htmlFor="commonStateInstance">Common state instance</label>
                <select
                  id="commonStateInstance"
                  className="dashboard-select"
                  value={commonStateInstanceId}
                  disabled={pending || !isSignedIn || instances.length === 0}
                  onChange={(event) => setCommonStateInstanceId(event.target.value)}
                >
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  onClick={() => syncCommonState(commonStateInstanceId, "push")}
                  disabled={pending || !isSignedIn || !commonStateInstanceId}
                >
                  Push
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => syncCommonState(commonStateInstanceId, "pull")}
                  disabled={pending || !isSignedIn || !commonStateInstanceId}
                >
                  Pull
                </Button>
              </div>
            </div>

            {instances.length === 0 ? (
              <div className="dashboard-empty">No instances yet.</div>
            ) : (
              <div className="dashboard-table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead>Common state</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {instances.map((instance) => (
                      <TableRow key={instance.id}>
                        <TableCell>{instance.name}</TableCell>
                        <TableCell>{instanceImage(instance)}</TableCell>
                        <TableCell>{formatBytes(instance.commonStateBytes)}</TableCell>
                        <TableCell>{formatDate(instance.updatedAt)}</TableCell>
                        <TableCell>
                          <div className="inline-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending || !isSignedIn}
                              onClick={() => syncCommonState(instance.id, "push")}
                            >
                              Push
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending || !isSignedIn}
                              onClick={() => syncCommonState(instance.id, "pull")}
                            >
                              Pull
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending || !isSignedIn}
                              onClick={() => deleteInstance(instance.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
            <CardDescription>Launch isolated workspaces and control runtime state.</CardDescription>
          </CardHeader>
          <CardContent className="panel-stack">
            <div className="dashboard-form">
              <div className="dashboard-field">
                <label htmlFor="sessionName">Session name</label>
                <Input
                  id="sessionName"
                  placeholder="sandbox"
                  value={sessionName}
                  disabled={pending || !isSignedIn}
                  onChange={(event) => setSessionName(event.target.value)}
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="sessionInstance">Instance</label>
                <select
                  id="sessionInstance"
                  className="dashboard-select"
                  value={sessionInstanceId}
                  disabled={pending || !isSignedIn || instances.length === 0}
                  onChange={(event) => setSessionInstanceId(event.target.value)}
                >
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="inline-actions">
                <Button onClick={createSession} disabled={pending || !isSignedIn || !sessionInstanceId}>
                  Create and start
                </Button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="dashboard-empty">No sessions yet.</div>
            ) : (
              <div className="dashboard-table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Instance</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session) => {
                      const primaryAction = sessionPrimaryAction(session);
                      return (
                        <TableRow key={session.id}>
                          <TableCell>{session.name}</TableCell>
                          <TableCell>{session.instanceName || "-"}</TableCell>
                          <TableCell>
                            <Badge variant={session.state === "running" ? "accent" : "default"}>
                              {session.state}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDate(session.updatedAt)}</TableCell>
                          <TableCell>
                            <div className="inline-actions">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={pending || !isSignedIn}
                                onClick={() => transitionSession(session.id, primaryAction)}
                              >
                                {primaryAction === "start" ? "Start" : "Stop"}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={pending || !isSignedIn}
                                onClick={() => transitionSession(session.id, "restart")}
                              >
                                Restart
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={pending || !isSignedIn}
                                onClick={() => transitionSession(session.id, "delete")}
                              >
                                Delete
                              </Button>
                              {session.previewUrl ? (
                                <a className="dashboard-link" href={session.previewUrl} target="_blank" rel="noreferrer">
                                  Preview
                                </a>
                              ) : null}
                              <a
                                className="dashboard-link"
                                href={`/runtime/sessions/${session.id}/editor?path=${encodeURIComponent("/workspace")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Editor
                              </a>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Usage-based billing summary with runtime and storage visibility.</CardDescription>
          </CardHeader>
          <CardContent className="panel-stack">
            <div className="metric-grid">
              <div className="metric-card">
                <div className="metric-label">Runtime minutes</div>
                <div className="metric-value">{formatNumber(totals.runtimeMinutes)}</div>
                <div className="metric-help">
                  Limit: {runtimeLimit ? formatNumber(runtimeLimit) : "unbounded"}
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${runtimePct}%` }} />
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Current storage</div>
                <div className="metric-value">{formatBytes(totals.currentStorageBytes)}</div>
                <div className="metric-help">
                  Limit: {storageLimitBytes ? formatBytes(storageLimitBytes) : "unbounded"}
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${storagePct}%` }} />
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Storage GB-days</div>
                <div className="metric-value">{formatNumber(totals.storageGbDays)}</div>
                <div className="metric-help">Monthly estimate: {formatNumber(totals.storageGbMonths)} GB-months</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Sessions</div>
                <div className="metric-value">
                  {formatNumber(report?.sessionsRunning || 0)} running / {formatNumber(report?.sessionsTotal || sessions.length)} total
                </div>
                <div className="metric-help">
                  Sleeping: {formatNumber(report?.sessionsSleeping || 0)} · stale eligible: {formatNumber(report?.sessionsStaleEligible || 0)}
                </div>
              </div>
            </div>
            <div className="status-box">BurstFlare uses usage-based billing only.</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Recent audit events for this workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <div className="dashboard-empty">No recent activity.</div>
            ) : (
              <div className="dashboard-table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.slice(0, 12).map((entry, index) => (
                      <TableRow key={entry.id || `${entry.action}-${index}`}>
                        <TableCell>{entry.action}</TableCell>
                        <TableCell>
                          {entry.targetType || "-"}
                          {entry.targetId ? `:${entry.targetId}` : ""}
                        </TableCell>
                        <TableCell>{formatDate(entry.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
