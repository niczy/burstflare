"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../primitives/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../primitives/card.js";
import { clientApiJson } from "../../../lib/client/api.js";
import type {
  AuthSession,
  AuthSessionsResponse,
  BillingCheckoutResponse,
  BillingSummaryResponse,
  Viewer
} from "../../../lib/types.js";

type ProfilePanelProps = {
  initialViewer: Viewer | null;
};

function normalizeError(error: unknown): string {
  if (error && typeof error === "object" && "error" in error) {
    return String((error as { error: unknown }).error || "Request failed");
  }
  return error instanceof Error ? error.message : "Request failed";
}

function formatUsd(value: number | undefined, currency = "usd"): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
    minimumFractionDigits: 2
  }).format(amount);
}

export function ProfilePanel({ initialViewer }: ProfilePanelProps) {
  const [viewer, setViewer] = useState<Viewer | null>(initialViewer);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [billing, setBilling] = useState<BillingSummaryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const identityLabel = useMemo(() => {
    if (!viewer?.user?.email) {
      return "Not signed in";
    }
    const role = viewer.membership?.role ? ` (${viewer.membership.role})` : "";
    return `${viewer.user.email}${role}`;
  }, [viewer]);

  async function refreshProfile() {
    setBusy(true);
    setError("");
    try {
      const [nextViewer, nextSessions, nextBilling] = await Promise.all([
        clientApiJson<Viewer>("/api/auth/me"),
        clientApiJson<AuthSessionsResponse>("/api/auth/sessions"),
        clientApiJson<BillingSummaryResponse>("/api/workspaces/current/billing")
      ]);
      setViewer(nextViewer);
      setSessions(Array.isArray(nextSessions.sessions) ? nextSessions.sessions : []);
      setBilling(nextBilling);
    } catch (refreshError) {
      setError(normalizeError(refreshError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPaymentMethod() {
    setBusy(true);
    setError("");
    try {
      const successUrl = new URL("/profile?billing=success", window.location.origin).toString();
      const cancelUrl = new URL("/profile?billing=cancel", window.location.origin).toString();
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
      if (!checkout.url) {
        throw new Error("Checkout URL missing");
      }
      window.location.href = checkout.url;
    } catch (checkoutError) {
      setError(normalizeError(checkoutError));
      setBusy(false);
    }
  }

  async function revokeSession(authSessionId: string) {
    setBusy(true);
    setError("");
    try {
      await clientApiJson(`/api/auth/sessions/${authSessionId}`, {
        method: "DELETE"
      });
      await refreshProfile();
    } catch (revokeError) {
      setError(normalizeError(revokeError));
      setBusy(false);
    }
  }

  async function logoutAll() {
    setBusy(true);
    setError("");
    try {
      await clientApiJson("/api/auth/logout-all", {
        method: "POST"
      });
      window.location.href = "/login";
    } catch (logoutError) {
      setError(normalizeError(logoutError));
      setBusy(false);
    }
  }

  return (
    <section className="panel-stack">
      <Card>
        <CardHeader>
          <CardTitle className="section-title">Profile</CardTitle>
          <CardDescription className="section-copy">{identityLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-actions">
            <Button variant="secondary" onClick={refreshProfile} disabled={busy}>
              Refresh
            </Button>
            <Button variant="secondary" onClick={logoutAll} disabled={busy}>
              Logout all
            </Button>
          </div>
          {error ? <div className="error-box">{error}</div> : null}
        </CardContent>
      </Card>

      <div className="profile-grid">
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>
              Manage payment methods and usage-based billing configuration.
            </CardDescription>
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
                <div>{formatUsd(billing?.estimate?.totalUsd, billing?.estimate?.currency || "usd")}</div>
              </div>
            </div>
            <div className="inline-actions">
              <Button onClick={addPaymentMethod} disabled={busy}>
                Add payment method
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Browser sessions</CardTitle>
            <CardDescription>Revoke sessions that should no longer stay active.</CardDescription>
          </CardHeader>
          <CardContent className="panel-stack">
            {sessions.length === 0 ? (
              <div className="status-box">No active browser sessions.</div>
            ) : (
              sessions.map((session) => (
                <div className="status-box" key={session.id}>
                  <div>
                    <strong>{session.kind || "browser"}</strong>
                  </div>
                  <div>{session.userAgent || "Unknown device"}</div>
                  <div>{session.ip || "Unknown IP"}</div>
                  <div className="inline-actions">
                    <Button variant="secondary" onClick={() => revokeSession(session.id)} disabled={busy}>
                      Revoke
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
