import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const TARGETS = ["apps", "packages", "scripts", "test"];
const extensions = new Set([".js", ".mjs"]);
const webExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const ALLOWED_DANGEROUSLY_SET_INNER_HTML = new Set([
  "apps/web/app/page.tsx",
  "apps/web/app/dashboard/page.tsx",
  "apps/web/app/docs/page.tsx",
  "apps/web/app/login/page.tsx",
  "apps/web/app/login/success/page.tsx",
  "apps/web/app/profile/page.tsx"
]);

const ALLOWED_LARGE_TEMPLATE_LITERAL_FILES = new Set([
  "apps/web/src/assets.ts",
  "apps/web/app/lib/app-script.ts"
]);
const LARGE_TEMPLATE_LITERAL_THRESHOLD = 20_000;
const TAILWIND_BUNDLE_TOKEN_THRESHOLD = 10;

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }
    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function walkWithExtensions(
  dir: string,
  extensionsSet: ReadonlySet<string>,
  files: string[] = []
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkWithExtensions(fullPath, extensionsSet, files);
      continue;
    }
    if (extensionsSet.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeForReport(fullPath: string): string {
  return path.relative(ROOT, fullPath).split(path.sep).join("/");
}

function countTokens(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function checkDangerouslySetInnerHtml(content: string, relativePath: string, violations: string[]): void {
  if (!content.includes("dangerouslySetInnerHTML")) {
    return;
  }
  if (ALLOWED_DANGEROUSLY_SET_INNER_HTML.has(relativePath)) {
    return;
  }
  violations.push(
    `${relativePath}: new dangerouslySetInnerHTML usage is blocked outside the explicit allowlist.`
  );
}

function checkLargeTemplateLiterals(content: string, relativePath: string, violations: string[]): void {
  if (ALLOWED_LARGE_TEMPLATE_LITERAL_FILES.has(relativePath)) {
    return;
  }
  const templateLiteralPattern = /`[\s\S]*?`/g;
  let match: RegExpExecArray | null = null;
  while ((match = templateLiteralPattern.exec(content)) !== null) {
    const literal = match[0] || "";
    if (literal.length >= LARGE_TEMPLATE_LITERAL_THRESHOLD) {
      violations.push(
        `${relativePath}: large template literal (${literal.length} chars) detected; move styles/scripts into modular files.`
      );
      return;
    }
  }
}

function checkTailwindUtilityBundles(content: string, relativePath: string, violations: string[]): void {
  const underWebApp = relativePath.startsWith("apps/web/app/");
  const underPrimitives = relativePath.startsWith("apps/web/app/components/primitives/");
  if (!underWebApp || underPrimitives) {
    return;
  }
  const classNamePattern = /className\s*=\s*"([^"]+)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = classNamePattern.exec(content)) !== null) {
    const classList = match[1] || "";
    if (countTokens(classList) >= TAILWIND_BUNDLE_TOKEN_THRESHOLD) {
      violations.push(
        `${relativePath}: large className utility bundle detected; compose shared primitives instead.`
      );
      return;
    }
  }
}

async function runWebRewriteGuardrails(): Promise<void> {
  const webRoot = path.join(ROOT, "apps", "web");
  const webFiles = await walkWithExtensions(webRoot, webExtensions);
  const violations: string[] = [];
  for (const file of webFiles) {
    const relativePath = normalizeForReport(file);
    const content = await readFile(file, "utf8");
    checkDangerouslySetInnerHtml(content, relativePath, violations);
    checkLargeTemplateLiterals(content, relativePath, violations);
    checkTailwindUtilityBundles(content, relativePath, violations);
  }
  if (violations.length > 0) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exit(1);
  }
}

const files: string[] = [];
for (const target of TARGETS) {
  await walk(path.join(ROOT, target), files);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
}

await runWebRewriteGuardrails();

process.stdout.write(`linted ${files.length} files\n`);
