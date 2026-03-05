import type { ApiError } from "../types.js";

type ClientApiRequestOptions = RequestInit & {
  expectedStatus?: number;
};

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

export async function clientApiJson<T>(
  path: string,
  { expectedStatus = 200, headers: requestHeaders = {}, ...init }: ClientApiRequestOptions = {}
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...requestHeaders
    }
  });
  if (response.status !== expectedStatus) {
    throw await parseApiError(response);
  }
  return response.json() as Promise<T>;
}
