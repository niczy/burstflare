"use client";

import { useMemo, useState } from "react";
import { ErrorBoundary } from "../../primitives/error-boundary.js";
import { RuntimeWorkbench } from "../runtime/runtime-workbench.js";
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
  BillingCheckoutResponse,
  BillingInvoiceResponse,
  BillingPortalResponse,
  BillingSummaryResponse,
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

type ToastKind = "info" | "success" | "error";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type RefreshOptions = {
  quiet?: boolean;
};

type RunActionOptions = {
  successMessage?: string;
  refresh?: boolean;
  optimistic?: () => (() => void) | void;
  onSuccess?: () => void;
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

function formatUsd(value: number | undefined | null, currency = "usd"): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
    minimumFractionDigits: 2
  }).format(amount);
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

function optimisticSessionState(action: "start" | "stop" | "restart", session: SessionRecord): string {
  if (action === "start") {
    return session.state === "running" ? "running" : "starting";
  }
  if (action === "stop") {
    return session.state === "sleeping" ? "sleeping" : "stopping";
  }
  return "starting";
}

function toastClassName(kind: ToastKind): string {
  if (kind === "success") {
    return "toast toast-success";
  }
  if (kind === "error") {
    return "toast toast-error";
  }
  return "toast toast-info";
}

export function DashboardPanel({ initialSnapshot }: DashboardPanelProps) {
  const [viewer, setViewer] = useState<Viewer | null>(initialSnapshot.viewer);
  const [instances, setInstances] = useState<InstanceRecord[]>(initialSnapshot.instances);
  const [sessions, setSessions] = useState<SessionRecord[]>(initialSnapshot.sessions);
  const [usage, setUsage] = useState<UsageResponse | null>(initialSnapshot.usage);
  const [report, setReport] = useState<AdminReport | null>(initialSnapshot.report);
  const [audit, setAudit] = useState<AuditRecord[]>(initialSnapshot.audit);
  const [billing, setBilling] = useState<BillingSummaryResponse | null>(initialSnapshot.billing);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(initialSnapshot.lastRefreshedAt);
  const [warning, setWarning] = useState<string>(initialSnapshot.warning || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [billingFlowStatus, setBillingFlowStatus] = useState(() => {
    if (typeof window === "undefined") {
      return "Billing flow idle.";
    }
    const state = new URLSearchParams(window.location.search).get("billing") || "";
    if (state === "success") {
      return "Stripe checkout completed. Refresh billing to confirm updates.";
    }
    if (state === "cancel") {
      return "Stripe checkout canceled. No payment method was changed.";
    }
    return "Billing flow idle.";
  });

  const [instanceName, setInstanceName] = useState("");
  const [instanceImageValue, setInstanceImageValue] = useState("ubuntu:24.04");
  const [instanceDescription, setInstanceDescription] = useState("");
  const [instanceBootstrapScript, setInstanceBootstrapScript] = useState("");
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

  function pushToast(kind: ToastKind, message: string): void {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((previous) => [...previous, { id, kind, message }].slice(-4));
    setTimeout(() => {
      setToasts((previous) => previous.filter((entry) => entry.id !== id));
    }, 4500);
  }

  async function refreshDashboard(options: RefreshOptions = {}): Promise<void> {
    const quiet = Boolean(options.quiet);
    if (!quiet) {
      setPending(true);
    }
    setError("");
    setWarning("");
    try {
      const nextViewer = await clientApiJson<Viewer>("/api/auth/me");
      setViewer(nextViewer);

      const [instancesResult, sessionsResult, usageResult, reportResult, auditResult, billingResult] = await Promise.allSettled([
        clientApiJson<InstancesResponse>("/api/instances"),
        clientApiJson<SessionsResponse>("/api/sessions"),
        clientApiJson<UsageResponse>("/api/usage"),
        clientApiJson<AdminReportResponse>("/api/admin/report"),
        clientApiJson<AuditResponse>("/api/audit"),
        clientApiJson<BillingSummaryResponse>("/api/workspaces/current/billing")
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

      const nextBilling = billingResult.status === "fulfilled" ? billingResult.value : null;
      if (billingResult.status === "rejected") {
        warnings.push("billing");
      }
      setBilling(nextBilling);

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
        setBilling(null);
        setWarning("Sign in to manage instances, sessions, usage, and billing.");
      } else {
        const message = normalizeError(refreshError);
        setError(message);
        pushToast("error", message);
      }
    } finally {
      if (!quiet) {
        setPending(false);
      }
    }
  }

  async function runAction(action: () => Promise<void>, options: RunActionOptions = {}): Promise<void> {
    setPending(true);
    setError("");
    let rollback: (() => void) | undefined;
    try {
      if (options.optimistic) {
        rollback = options.optimistic() || undefined;
      }
      await action();
      if (options.onSuccess) {
        options.onSuccess();
      }
      if (options.successMessage) {
        pushToast("success", options.successMessage);
      }
      if (options.refresh !== false) {
        await refreshDashboard({ quiet: true });
      }
    } catch (actionError) {
      if (rollback) {
        rollback();
      }
      const message = normalizeError(actionError);
      setError(message);
      pushToast("error", message);
    } finally {
      setPending(false);
    }
  }

  async function createInstance(): Promise<void> {
    const name = instanceName.trim();
    const image = instanceImageValue.trim() || "ubuntu:24.04";
    const bootstrapScript = instanceBootstrapScript.trim();
    if (!name) {
      setError("Instance name is required.");
      return;
    }
    const optimisticId = `tmp-ins-${Date.now()}`;
    const optimisticInstance: InstanceRecord = {
      id: optimisticId,
      name,
      description: instanceDescription.trim(),
      image,
      baseImage: image,
      bootstrapScript: bootstrapScript || null,
      commonStateBytes: 0,
      updatedAt: new Date().toISOString()
    };
    await runAction(
      async () => {
        await clientApiJson<{ instance: InstanceRecord }>("/api/instances", {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({
            name,
            description: instanceDescription.trim(),
            image,
            baseImage: image,
            ...(bootstrapScript ? { bootstrapScript } : {})
          })
        });
      },
      {
        successMessage: "Instance created.",
        optimistic: () => {
          setInstances((previous) => [...previous, optimisticInstance]);
          setSessionInstanceId((current) => current || optimisticId);
          setCommonStateInstanceId((current) => current || optimisticId);
          return () => {
            setInstances((previous) => previous.filter((entry) => entry.id !== optimisticId));
          };
        },
        onSuccess: () => {
          setInstanceName("");
          setInstanceDescription("");
          setInstanceBootstrapScript("");
        }
      }
    );
  }

  async function syncCommonState(instanceId: string, direction: "push" | "pull"): Promise<void> {
    if (!instanceId) {
      setError("Select an instance first.");
      return;
    }
    await runAction(
      async () => {
        await clientApiJson(`/api/instances/${instanceId}/${direction}`, {
          method: "POST"
        });
      },
      {
        successMessage: direction === "push" ? "Common state pushed." : "Common state pulled."
      }
    );
  }

  async function deleteInstance(instanceId: string): Promise<void> {
    const removed = instances.find((instance) => instance.id === instanceId) || null;
    const index = instances.findIndex((instance) => instance.id === instanceId);
    await runAction(
      async () => {
        await clientApiJson(`/api/instances/${instanceId}`, {
          method: "DELETE"
        });
      },
      {
        successMessage: "Instance deleted.",
        optimistic: () => {
          setInstances((previous) => previous.filter((entry) => entry.id !== instanceId));
          setSessionInstanceId((current) => (current === instanceId ? "" : current));
          setCommonStateInstanceId((current) => (current === instanceId ? "" : current));
          return () => {
            if (!removed || index < 0) {
              return;
            }
            setInstances((previous) => {
              if (previous.some((entry) => entry.id === removed.id)) {
                return previous;
              }
              const next = [...previous];
              next.splice(Math.min(index, next.length), 0, removed);
              return next;
            });
          };
        }
      }
    );
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

    const optimisticId = `tmp-ses-${Date.now()}`;
    const optimisticSession: SessionRecord = {
      id: optimisticId,
      name,
      state: "starting",
      instanceId: sessionInstanceId,
      instanceName: instances.find((entry) => entry.id === sessionInstanceId)?.name || null,
      previewUrl: null,
      updatedAt: new Date().toISOString()
    };

    await runAction(
      async () => {
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
      },
      {
        successMessage: "Session created and start requested.",
        optimistic: () => {
          setSessions((previous) => [...previous, optimisticSession]);
          return () => {
            setSessions((previous) => previous.filter((entry) => entry.id !== optimisticId));
          };
        },
        onSuccess: () => {
          setSessionName("sandbox");
        }
      }
    );
  }

  async function transitionSession(sessionId: string, action: "start" | "stop" | "restart" | "delete"): Promise<void> {
    const previousSession = sessions.find((entry) => entry.id === sessionId) || null;
    const previousIndex = sessions.findIndex((entry) => entry.id === sessionId);

    await runAction(
      async () => {
        if (action === "delete") {
          await clientApiJson(`/api/sessions/${sessionId}`, {
            method: "DELETE"
          });
          return;
        }
        await clientApiJson(`/api/sessions/${sessionId}/${action}`, {
          method: "POST"
        });
      },
      {
        successMessage:
          action === "delete"
            ? "Session deleted."
            : action === "restart"
              ? "Session restart requested."
              : action === "start"
                ? "Session start requested."
                : "Session stop requested.",
        optimistic: () => {
          if (action === "delete") {
            setSessions((previous) => previous.filter((entry) => entry.id !== sessionId));
            return () => {
              if (!previousSession || previousIndex < 0) {
                return;
              }
              setSessions((previous) => {
                if (previous.some((entry) => entry.id === previousSession.id)) {
                  return previous;
                }
                const next = [...previous];
                next.splice(Math.min(previousIndex, next.length), 0, previousSession);
                return next;
              });
            };
          }

          setSessions((previous) =>
            previous.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    state: optimisticSessionState(action, session),
                    updatedAt: new Date().toISOString()
                  }
                : session
            )
          );

          return () => {
            if (!previousSession) {
              return;
            }
            setSessions((previous) =>
              previous.map((session) =>
                session.id === sessionId
                  ? previousSession
                  : session
              )
            );
          };
        }
      }
    );
  }

  async function addPaymentMethod(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    setPending(true);
    setError("");
    setBillingFlowStatus("Opening secure Stripe checkout...");
    try {
      const successUrl = new URL("/dashboard?billing=success", window.location.origin).toString();
      const cancelUrl = new URL("/dashboard?billing=cancel", window.location.origin).toString();
      const checkout = await clientApiJson<BillingCheckoutResponse>("/api/workspaces/current/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          successUrl,
          cancelUrl
        })
      });
      const checkoutUrl = checkout.checkoutSession?.url || checkout.url || "";
      if (!checkoutUrl) {
        throw new Error("Checkout session URL missing.");
      }
      pushToast("info", "Redirecting to Stripe checkout.");
      window.location.assign(checkoutUrl);
    } catch (checkoutError) {
      const message = normalizeError(checkoutError);
      setError(message);
      setBillingFlowStatus("Checkout could not be started.");
      pushToast("error", message);
      setPending(false);
    }
  }

  async function openBillingPortal(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    setPending(true);
    setError("");
    setBillingFlowStatus("Opening billing portal...");
    try {
      const portal = await clientApiJson<BillingPortalResponse>("/api/workspaces/current/billing/portal", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          returnUrl: new URL("/dashboard", window.location.origin).toString()
        })
      });
      const portalUrl = portal.portalSession?.url || "";
      if (!portalUrl) {
        throw new Error("Billing portal URL missing.");
      }
      pushToast("info", "Redirecting to billing portal.");
      window.location.assign(portalUrl);
    } catch (portalError) {
      const message = normalizeError(portalError);
      setError(message);
      setBillingFlowStatus("Billing portal could not be started.");
      pushToast("error", message);
      setPending(false);
    }
  }

  async function createUsageInvoice(): Promise<void> {
    await runAction(
      async () => {
        const created = await clientApiJson<BillingInvoiceResponse>("/api/workspaces/current/billing/invoice", {
          method: "POST"
        });
        if (created.invoice?.hostedInvoiceUrl && typeof window !== "undefined") {
          window.open(created.invoice.hostedInvoiceUrl, "_blank", "noopener,noreferrer");
          setBillingFlowStatus("Usage invoice created. Hosted invoice opened in a new tab.");
          return;
        }
        if (created.invoice === null) {
          setBillingFlowStatus("No unbilled usage yet.");
          return;
        }
        setBillingFlowStatus("Usage invoice created.");
      },
      {
        successMessage: "Billing invoice request completed."
      }
    );
  }

  const billingEstimate = billing?.pendingInvoiceEstimate;

  return (
    <section className="dashboard-stack">
      <Card>
        <CardHeader>
          <CardTitle className="section-title">Dashboard</CardTitle>
          <CardDescription className="section-copy">{identityLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="dashboard-toolbar">
            <Button variant="secondary" onClick={() => refreshDashboard()} disabled={pending}>
              Refresh
            </Button>
            <span className="dashboard-copy">Last refresh: {formatDate(lastRefreshedAt)}</span>
          </div>
          {warning ? <div className="status-box">{warning}</div> : null}
          {error ? <div className="error-box">{error}</div> : null}
        </CardContent>
      </Card>

      <div className="dashboard-grid">
        <ErrorBoundary fallback={<div className="section-fallback">Instances section failed. Refresh to retry.</div>}>
          <Card>
            <CardHeader>
              <CardTitle>Instances</CardTitle>
              <CardDescription>
                Reusable runtime definitions (image, startup bootstrap script, shared <code>/home/flare</code> common state).
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
                <div className="dashboard-field">
                  <label htmlFor="instanceBootstrapScript">Startup bootstrap (optional)</label>
                  <textarea
                    id="instanceBootstrapScript"
                    className="dashboard-textarea"
                    placeholder={"#!/bin/sh\napt-get update && apt-get install -y curl"}
                    value={instanceBootstrapScript}
                    disabled={pending || !isSignedIn}
                    onChange={(event) => setInstanceBootstrapScript(event.target.value)}
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
                        <TableHead>Bootstrap</TableHead>
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
                          <TableCell>{instance.bootstrapScript ? "Configured" : "Default"}</TableCell>
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
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="section-fallback">Sessions section failed. Refresh to retry.</div>}>
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
        </ErrorBoundary>
      </div>

      <div className="dashboard-grid">
        <ErrorBoundary fallback={<div className="section-fallback">Usage section failed. Refresh to retry.</div>}>
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
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="section-fallback">Billing section failed. Refresh to retry.</div>}>
          <Card>
            <CardHeader>
              <CardTitle>Billing actions</CardTitle>
              <CardDescription>Manage payment method setup, portal access, and usage invoices.</CardDescription>
            </CardHeader>
            <CardContent className="panel-stack">
              <div className="meta-grid">
                <div className="status-box">
                  <strong>Provider</strong>
                  <div>{billing?.billing?.provider || "Not configured"}</div>
                </div>
                <div className="status-box">
                  <strong>Status</strong>
                  <div>{billing?.billing?.billingStatus || "Not configured"}</div>
                </div>
                <div className="status-box">
                  <strong>Default payment method</strong>
                  <div>{billing?.billing?.defaultPaymentMethodId || "Not set"}</div>
                </div>
                <div className="status-box">
                  <strong>Pending invoice estimate</strong>
                  <div>{formatUsd(billingEstimate?.totalUsd, billingEstimate?.currency || "usd")}</div>
                </div>
              </div>
              <div className="inline-actions">
                <Button onClick={addPaymentMethod} disabled={pending || !isSignedIn}>
                  Add payment method
                </Button>
                <Button variant="secondary" onClick={openBillingPortal} disabled={pending || !isSignedIn}>
                  Open billing portal
                </Button>
                <Button variant="secondary" onClick={createUsageInvoice} disabled={pending || !isSignedIn}>
                  Create usage invoice
                </Button>
                <Button variant="secondary" onClick={() => refreshDashboard()} disabled={pending || !isSignedIn}>
                  Refresh billing
                </Button>
              </div>
              <div className="status-box">{billingFlowStatus}</div>
            </CardContent>
          </Card>
        </ErrorBoundary>
      </div>

      <div className="dashboard-grid">
        <ErrorBoundary fallback={<div className="section-fallback">Runtime section failed. Refresh to retry.</div>}>
          <RuntimeWorkbench
            sessions={sessions}
            disabled={pending || !isSignedIn}
            onError={setError}
            onToast={pushToast}
          />
        </ErrorBoundary>

        <ErrorBoundary fallback={<div className="section-fallback">Activity section failed. Refresh to retry.</div>}>
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
        </ErrorBoundary>
      </div>

      {toasts.length > 0 ? (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={toastClassName(toast.kind)}>
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
