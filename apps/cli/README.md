# @burstflare/flare

`flare` is the command-line interface for BurstFlare.

It gives you direct access to the BurstFlare control plane for:
- authentication
- workspace and membership management
- template and release workflows
- session lifecycle and runtime access
- snapshots, reports, exports, and reconcile operations

## Install

Global install:

```bash
npm install -g @burstflare/flare
```

One-off use with `npx`:

```bash
npx @burstflare/flare help
```

The installed command is:

```bash
flare
```

## Quick Start

Register against a local BurstFlare dev server:

```bash
flare auth register --email you@example.com --url http://127.0.0.1:8787
```

Create and promote a template:

```bash
flare template create node-dev --url http://127.0.0.1:8787
flare template upload <templateId> --version 1.0.0 --url http://127.0.0.1:8787
flare template promote <templateId> <versionId> --url http://127.0.0.1:8787
```

Launch a session and attach:

```bash
flare session up sandbox --template <templateId> --url http://127.0.0.1:8787
flare ssh <sessionId> --url http://127.0.0.1:8787
```

## Common Commands

```bash
flare auth whoami
flare workspace
flare templates
flare template inspect <templateId>
flare sessions
flare snapshot list <sessionId>
flare report
```

## Config

The CLI stores its local config at:

```text
~/.config/flare/config.json
```

You can override that path with:

```bash
FLARE_CONFIG=/path/to/config.json
```

## Notes

- BurstFlare expects a running API endpoint. Use `--url` to point the CLI at your local or deployed control plane.
- For local development, the default dashboard and Worker-compatible dev server run at `http://127.0.0.1:8787`.

## License

Licensed under Apache-2.0. See `LICENSE`.
