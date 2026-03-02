export function clone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export function defaultNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ") || "User";
}

export function parseJson(input: string | null | undefined): any {
  if (!input) {
    return {};
  }
  return JSON.parse(input);
}

export function toJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers || undefined);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

export function unauthorized(message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function notFound(message = "Not found"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

type CookieOptions = {
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  maxAge?: number;
};

export function cookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  } else {
    parts.push("SameSite=Lax");
  }
  if (options.maxAge) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  return parts.join("; ");
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  const parts = header.split(";").map((item) => item.trim());
  for (const part of parts) {
    const [key, raw = ""] = part.split("=");
    if (key === name) {
      return decodeURIComponent(raw);
    }
  }
  return null;
}
