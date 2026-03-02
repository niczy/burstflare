# BurstFlare Beta Runbook

Status as of February 28, 2026.

This document defines the operational baseline for the current BurstFlare beta deployment.

## 1. Supported Beta Scope

- Single production Cloudflare deployment at `burstflare.nicholas-zhaoyu.workers.dev`.
- Cloudflare-backed control plane:
  - D1
  - KV
  - R2
  - Queues
  - Workflows
  - Durable Objects
  - Containers
- User-facing beta surfaces:
  - browser auth, passkeys, recovery codes, Turnstile
  - template creation, versioning, builds, promotion, rollback
  - session start, stop, restart, delete
  - preview, browser terminal, browser editor, SSH tunnel
  - snapshots, restore, autosave
- Explicitly out of current beta scope:
  - multi-region failover
  - real external OCI image builds
  - full IDE experience beyond the bundled browser editor
  - enterprise-grade secrets management

## 2. Daily Operator Checks

Run these at the start of each operator day:

1. `npm run cf:verify`
2. `npm run cf:validate-schema`
3. `node scripts/smoke.mjs --base-url https://burstflare.nicholas-zhaoyu.workers.dev`
4. `curl -fsS https://burstflare.nicholas-zhaoyu.workers.dev/api/health`
5. Inspect `/api/admin/report` from an operator account and confirm:
   - no unexpected `buildsDeadLettered`
   - no unexpected `buildsStuck`
   - no runaway `sessionsSleeping`
   - no unexpected `activeUploadGrants`

## 3. Incident Procedures

### Auth Incident

- Check `/api/health` for `turnstileEnabled`.
- Verify Turnstile credentials are still present in the deploy environment.
- Verify KV access for auth and rate-limit state.
- If browser auth is degraded, confirm passkey and recovery-code flows independently.

### Build Incident

- Inspect `/api/template-builds` for `failed`, `retrying`, and `dead_lettered`.
- Pull the relevant `/api/template-builds/:id/log`.
- Use `flare build retry <buildId>` or `flare build retry-dead-lettered` for controlled recovery.
- If build dispatch is stuck globally, verify Queue consumers and the `BUILD_WORKFLOW` binding from `/api/health`.

### Runtime Incident

- Inspect `/api/sessions/:id` for runtime analytics:
  - `runtimeStatus`
  - `runtimeState`
  - `lastBootstrapAt`
  - `lastLifecyclePhase`
- Check preview and editor routes for the affected session.
- Mint a fresh SSH token and confirm the tunnel command still resolves.
- If runtime state is stale, use session restart before destructive cleanup.

### Storage Incident

- Verify R2 bucket access for templates, snapshots, and build artifacts.
- Confirm the affected artifact keys still exist.
- Use workspace export before any destructive repair work.

## 4. Rollout Checklist

### One-command deploy

The `deploy` script runs the full pipeline: CI → schema validation → wrangler config generation → deploy → smoke tests.

```bash
npm run deploy                # production (default)
npm run deploy:staging        # staging
```

Flags (pass after `--`):

| Flag | Effect |
|------|--------|
| `--skip-ci` | Skip lint / typecheck / build / test (useful when CI already passed) |
| `--skip-smoke` | Skip post-deploy smoke tests |
| `--base-url=<url>` | Override the smoke-test target URL |

Example:

```bash
npm run deploy -- --skip-ci --base-url=https://staging.burstflare.dev
```

### Manual steps (if not using the deploy script)

1. `npm run ci`
2. Authenticate Wrangler if needed (`npx wrangler whoami`)
3. `npm run cf:validate-schema`
4. `node scripts/cloudflare-generate-wrangler.mjs > wrangler.generated.toml`
5. `npx wrangler deploy -c wrangler.generated.toml`
6. Wait for the reported `Current Version ID`
7. `node scripts/smoke.mjs --base-url https://burstflare.nicholas-zhaoyu.workers.dev`

### Post-deploy verification

After every rollout (automated or manual), run one manual operator check:

1. Create a session
2. Open preview
3. Open editor
4. Stop the session

Only announce the rollout after smoke plus the manual runtime check succeed.

## 5. Limited Beta Onboarding

- Start with operator-controlled accounts only.
- Onboard one workspace at a time.
- Require users to stay inside the documented beta scope.
- Ask users to prefer browser preview/editor first, then SSH if needed.
- Treat all destructive actions as operator-assisted until the beta proves stable.

## 6. Recovery Defaults

- Prefer restart over delete.
- Prefer retry over manual state edits.
- Prefer workspace export before any cleanup that removes user-visible records.
- Prefer rolling back a template release over patching a broken active version in place.
