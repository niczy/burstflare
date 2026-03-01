# BurstFlare

BurstFlare is a hosted workspace product for creating reusable dev environments, launching working sessions, and handing users into preview, browser tools, or SSH without bouncing between multiple systems.

## What It Does

- account and workspace management
- team invites, access review, and recovery flows
- template creation, versioning, and release promotion
- live workspace sessions with preview, terminal, editor, and SSH access
- snapshots, activity history, reporting, and export tools

## Product Quick Start

1. Open the product:

```text
https://burstflare.dev
```

2. Install the CLI:

```bash
npm install -g @burstflare/flare
```

The install checks for the local tools used by `flare ssh` and warns if `wstunnel` or `ssh` is missing.

You can verify local CLI dependencies any time with:

```bash
flare doctor
```

3. Create your account. `flare` points to `https://burstflare.dev` by default.

```bash
flare auth register --email you@example.com
```

4. Create and promote a template:

```bash
flare template create node-dev
flare template upload <templateId> --version 1.0.0
flare template promote <templateId> <versionId>
```

5. Launch a workspace and attach:

```bash
flare session up sandbox --template <templateId>
flare ssh <sessionId>
```

`flare ssh` now wakes sleeping sessions if needed, then opens the tunnel and SSH session directly. Use `flare ssh <sessionId> --print` if you want the raw command instead.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start the local app:

```bash
npm run dev
```

3. Open:

```text
http://127.0.0.1:8787
```

4. Point the CLI at local only when you are testing against the local stack:

```bash
flare auth register --email you@example.com --url http://127.0.0.1:8787
```

## Common Commands

```bash
npm run ci
npm run smoke
npm run ui:smoke
npm run npm:cli:smoke
npm run release:validate
```

## Project Layout

- `apps/edge`: API and runtime entrypoints
- `apps/web`: browser shell assets
- `apps/cli`: `flare` CLI
- `packages/shared`: shared service and domain logic
- `containers/session`: runtime image
- `infra/migrations`: schema migrations
- `scripts`: build, smoke, release, and deploy utilities
- `spec`: product docs, architecture, plan, changelog, todo, and runbook

## Current Status

The product is live at `https://burstflare.dev`, the web app is production-oriented by default, and the CLI ships as `@burstflare/flare`.

## License

Licensed under Apache-2.0. See `LICENSE`.
