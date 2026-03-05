import { headers } from "next/headers";
import type { ApiError, HealthResponse } from "../types.js";
import type { Viewer } from "../types.js";

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
