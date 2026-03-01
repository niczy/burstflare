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

The npm install now checks for the OpenSSH tools used by `flare ssh` and warns if `ssh` or `ssh-keygen` is missing.

You can re-check your machine any time with:

```bash
flare doctor
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

The CLI talks to `https://burstflare.dev` by default.

Register:

```bash
flare auth register --email you@example.com
```

Create and promote a template:

```bash
flare template create node-dev
flare template upload <templateId> --version 1.0.0
flare template promote <templateId> <versionId>
```

Launch a session and attach:

```bash
flare session up sandbox --template <templateId>
flare ssh <sessionId>
```

`flare ssh` wakes sleeping sessions if needed, provisions a per-session SSH key in your local `flare` config directory, syncs the public key to the session, and opens the tunnel and SSH session directly. Add `--print` to inspect the tunnel endpoint and local attach details.

## Common Commands

```bash
flare auth whoami
flare doctor
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

- Use `--url` only when you want to target a non-default environment, such as local development.
- For local development, the dashboard runs at `http://127.0.0.1:8787`.

## License

Licensed under Apache-2.0. See `LICENSE`.
