import { headers } from "next/headers";
import type {
  AdminReportResponse,
  ApiError,
  AuditResponse,
  BillingSummaryResponse,
  DashboardSnapshot,
  HealthResponse,
  InstancesResponse,
  SessionsResponse,
  UsageResponse,
  Viewer
} from "../types.js";

type ServerApiRequestOptions = RequestInit & {
  requireAuth?: boolean;
};

function readRequestHeaders(): Headers | null {
  try {
    return headers();
  } catch (_error) {
    return null;
  }
}

function resolveServerBaseUrl(): string {
  const forcedBaseUrl = String(process.env.BURSTFLARE_WEB_API_BASE_URL || "").trim();
  if (forcedBaseUrl) {
    return forcedBaseUrl.replace(/\/+$/, "");
  }
  const requestHeaders = readRequestHeaders();
  const host = requestHeaders?.get("x-forwarded-host") || requestHeaders?.get("host");
  const protocol = requestHeaders?.get("x-forwarded-proto") || "https";
  if (host) {
    return `${protocol}://${host}`;
  }
  return "https://burstflare.dev";
}

function mergeHeaders(extraHeaders: HeadersInit = {}, requireAuth = false): Headers {
  const nextHeaders = new Headers(extraHeaders);
  nextHeaders.set("accept", "application/json");
  if (requireAuth) {
    const requestHeaders = readRequestHeaders();
    const cookieHeader = requestHeaders?.get("cookie");
    const authorizationHeader = requestHeaders?.get("authorization");
    if (cookieHeader) {
      nextHeaders.set("cookie", cookieHeader);
    }
    if (authorizationHeader) {
      nextHeaders.set("authorization", authorizationHeader);
    }
  }
  return nextHeaders;
}

async function parseApiError(response: Response): Promise<ApiError> {
  const fallback: ApiError = {
    error: `Request failed (${response.status})`,
    status: response.status
  };
  try {
    const json = await response.json();
    if (json && typeof json === "object" && "error" in json) {
      return {
        ...(json as ApiError),
        status: response.status
      };
    }
  } catch (_error) {}
  return fallback;
}

export async function serverApiJson<T>(
  path: string,
  { requireAuth = false, headers: requestHeaders = {}, ...init }: ServerApiRequestOptions = {}
): Promise<T> {
  const baseUrl = resolveServerBaseUrl();
  const url = new URL(path, `${baseUrl}/`).toString();
  const response = await fetch(url, {
    ...init,
    headers: mergeHeaders(requestHeaders, requireAuth),
    cache: init.cache ?? "no-store"
  });
  if (!response.ok) {
    throw await parseApiError(response);
  }
  return response.json() as Promise<T>;
}

export async function getHealth(): Promise<HealthResponse> {
  return serverApiJson<HealthResponse>("/api/health");
}

export async function getViewer(): Promise<Viewer | null> {
  try {
    return await serverApiJson<Viewer>("/api/auth/me", {
      requireAuth: true
    });
  } catch (_error) {
    return null;
  }
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      viewer: null,
      instances: [],
      sessions: [],
      usage: null,
      report: null,
      audit: [],
      billing: null,
      lastRefreshedAt: null,
      warning: null
    };
  }

  const [instancesResult, sessionsResult, usageResult, reportResult, auditResult, billingResult] = await Promise.allSettled([
    serverApiJson<InstancesResponse>("/api/instances", { requireAuth: true }),
    serverApiJson<SessionsResponse>("/api/sessions", { requireAuth: true }),
    serverApiJson<UsageResponse>("/api/usage", { requireAuth: true }),
    serverApiJson<AdminReportResponse>("/api/admin/report", { requireAuth: true }),
    serverApiJson<AuditResponse>("/api/audit", { requireAuth: true }),
    serverApiJson<BillingSummaryResponse>("/api/workspaces/current/billing", { requireAuth: true })
  ]);

  const warnings: string[] = [];
  const instances =
    instancesResult.status === "fulfilled"
      ? Array.isArray(instancesResult.value.instances)
        ? instancesResult.value.instances
        : []
      : [];
  if (instancesResult.status === "rejected") {
    warnings.push("instances");
  }

  const sessions =
    sessionsResult.status === "fulfilled"
      ? Array.isArray(sessionsResult.value.sessions)
        ? sessionsResult.value.sessions
        : []
      : [];
  if (sessionsResult.status === "rejected") {
    warnings.push("sessions");
  }

  const usage = usageResult.status === "fulfilled" ? usageResult.value : null;
  if (usageResult.status === "rejected") {
    warnings.push("usage");
  }

  const report = reportResult.status === "fulfilled" ? reportResult.value.report : null;
  if (reportResult.status === "rejected") {
    warnings.push("report");
  }

  const audit =
    auditResult.status === "fulfilled"
      ? Array.isArray(auditResult.value.audit)
        ? auditResult.value.audit
        : []
      : [];
  if (auditResult.status === "rejected") {
    warnings.push("activity");
  }

  const billing = billingResult.status === "fulfilled" ? billingResult.value : null;
  if (billingResult.status === "rejected") {
    warnings.push("billing");
  }

  return {
    viewer,
    instances,
    sessions,
    usage,
    report,
    audit,
    billing,
    lastRefreshedAt: new Date().toISOString(),
    warning:
      warnings.length > 0
        ? `Some sections could not be loaded: ${warnings.join(", ")}.`
        : null
  };
}
