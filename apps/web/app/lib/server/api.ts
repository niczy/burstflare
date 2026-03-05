import type { ApiError, HealthResponse } from "../types.js";

type ServerApiRequestOptions = RequestInit & {
  requireAuth?: boolean;
};

function resolveServerBaseUrl(): string {
  const forcedBaseUrl = String(process.env.BURSTFLARE_WEB_API_BASE_URL || "").trim();
  if (forcedBaseUrl) {
    return forcedBaseUrl.replace(/\/+$/, "");
  }
  return "http://127.0.0.1:8787";
}

function mergeHeaders(extraHeaders: HeadersInit = {}, requireAuth = false): Headers {
  const nextHeaders = new Headers(extraHeaders);
  nextHeaders.set("accept", "application/json");
  if (requireAuth) {
    const authHeader = process.env.BURSTFLARE_WEB_API_AUTH_HEADER || "";
    if (authHeader) {
      nextHeaders.set("authorization", authHeader);
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
