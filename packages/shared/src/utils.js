export function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function createId(prefix) {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export function defaultNameFromEmail(email) {
  const local = email.split("@")[0] || "user";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ") || "User";
}

export function parseJson(input) {
  if (!input) {
    return {};
  }
  return JSON.parse(input);
}

export function toJson(data, init = {}) {
  const headers = new Headers(init.headers || undefined);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

export function unauthorized(message = "Unauthorized") {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function notFound(message = "Not found") {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function cookie(name, value, options = {}) {
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

export function readCookie(header, name) {
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
