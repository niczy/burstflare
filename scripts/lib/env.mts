import { readFile } from "node:fs/promises";
import path from "node:path";

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export async function loadEnv(filePath = ".env"): Promise<Record<string, string>> {
  const absolute = path.resolve(process.cwd(), filePath);
  let content = "";
  try {
    content = await readFile(absolute, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1).trim());
    env[key] = value;
  }
  return env;
}

export function mergeEnv(
  dotEnv: Record<string, string>,
  runtimeEnv: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  return {
    ...dotEnv,
    ...runtimeEnv
  };
}

export function getRequiredEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallbackKeys: string[] = []
): string {
  for (const candidate of [key, ...fallbackKeys]) {
    const value = env[candidate];
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: ${key}`);
}

export function slugifyDomain(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
