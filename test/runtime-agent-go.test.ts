import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("go runtime agent unit tests pass when Go is available", (t) => {
  const probe = spawnSync("go", ["version"], {
    encoding: "utf8"
  });
  if (probe.status !== 0) {
    t.skip("Go toolchain is unavailable");
    return;
  }

  const cwd = path.join(process.cwd(), "apps", "runtime-agent");
  const result = spawnSync("go", ["test", "./..."], {
    cwd,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
