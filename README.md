# BurstFlare

BurstFlare is a Cloudflare-native control plane for disposable development workspaces.

It combines:
- account and workspace management
- template and release management
- queue and workflow driven builds
- container-backed runtime sessions
- browser preview, browser terminal, editor, and SSH access
- snapshots, audit, quota, and operator tooling

The stack is built around Cloudflare Workers, D1, KV, R2, Queues, Workflows, Durable Objects, and Containers.

## What You Get

- A browser-first dashboard for onboarding, workspace control, template management, session launch, snapshots, and reporting
- A `flare` CLI for auth, template, release, session, reconcile, and export workflows
- Cloudflare provisioning and validation scripts for local and hosted environments
- CI, smoke checks, and a deployable Worker path

## Quick Start

### Local Dashboard

1. Install dependencies.

```bash
npm install
```

2. Start the local dev server.

```bash
npm run dev
```

3. Open the homepage.

```text
http://127.0.0.1:8787
```

The homepage includes a built-in Quick Start rail that walks through registration, template creation, promotion, and session launch.

### CLI Quick Start

1. Register with the local control plane.

```bash
flare auth register --email you@example.com --url http://127.0.0.1:8787
```

2. Create a template and queue a build.

```bash
flare template create node-dev --url http://127.0.0.1:8787
flare template upload <templateId> --version 1.0.0 --url http://127.0.0.1:8787
```

3. Promote the version and launch a session.

```bash
flare template promote <templateId> <versionId> --url http://127.0.0.1:8787
flare session up sandbox --template <templateId> --url http://127.0.0.1:8787
```

4. Attach with SSH when needed.

```bash
flare ssh <sessionId> --url http://127.0.0.1:8787
```

## Common Commands

```bash
npm run ci
npm run smoke
npm run ui:smoke
npm run release:validate
```

Cloudflare operations:

```bash
npm run cf:verify
npm run cf:provision
npm run cf:migrate
npm run cf:generate
```

## Deploy To Cloudflare

1. Configure your local `.env` with Cloudflare account details, API token, and optional Turnstile keys.
2. Provision resources.
3. Apply migrations.
4. Generate Wrangler config.
5. Deploy with Wrangler.

Typical flow:

```bash
npm run cf:provision
npm run cf:migrate
npm run cf:generate
npx wrangler deploy -c wrangler.generated.toml
```

If you are using Cloudflare Containers locally, make sure Docker is available before deploy.

## Project Layout

- `apps/edge`: Worker app, API routes, runtime wiring
- `apps/web`: browser shell asset bundle
- `apps/cli`: `flare` CLI
- `packages/shared`: service layer, stores, domain logic
- `containers/session`: runtime container image
- `infra/migrations`: D1 schema migrations
- `scripts`: build, smoke, Cloudflare provisioning, validation, and release scripts
- `spec`: product docs, architecture, plan, changelog, todo, runbook

## Current Status

The planned product stack is implemented and deployed. The main follow-up work left is optional scale tuning, such as replacing the remaining normalized store abstraction with more direct repository-style persistence if future load requires it.

## License

Licensed under Apache-2.0. See `LICENSE`.
