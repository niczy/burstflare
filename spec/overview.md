# BurstFlare Overview

## Product Summary

BurstFlare is a Cloudflare-native platform for launching on-demand development environments that behave like real remote machines without the cost profile of always-on infrastructure. A user signs in through the web app or CLI, chooses a template, and gets an isolated dev session that starts on first use, sleeps automatically when idle, and can be reached over SSH or through a browser-based workspace.

The product is built for bursty developer workflows: short-lived feature work, CI/debug sessions, review environments, one-off builds, and ad hoc remote shells. Its core promise is simple:

- Fast path from "I need a machine" to "I have a shell".
- No idle compute cost.
- Real SSH and port-forwarding, not a browser-only toy.
- A fully managed control plane built entirely on Cloudflare.

## Problem

Existing cloud development environments are strong for always-on, GitHub-centric workflows, but they are expensive or operationally heavy for intermittent use. The common pain points are:

- Users pay for suspended storage and idle machines.
- Teams have to manage VM fleets, autosleep rules, or bespoke SSH gateways.
- Browser-only tools break workflows that depend on SSH, `scp`, `rsync`, tunnels, or standard terminal tooling.
- Template management is fragmented between local config, source repos, and manually maintained images.

BurstFlare addresses that gap with a serverless control plane, ephemeral edge containers, centralized template storage, and a first-class CLI.

## What The Product Delivers

BurstFlare combines four product surfaces into one platform:

1. Web application
   - User signup, sign-in, and session approval.
   - Template browsing and session launch.
   - Session dashboard, logs, status, usage, and lifecycle controls.
   - Browser terminal / browser IDE access for users who do not want to use a local SSH client.

2. CLI
   - Device-flow login tied to the same account system as the web app.
   - Session creation, listing, SSH attach, stop, delete, and log access.
   - Template upload and promotion commands for privileged users.
   - Local developer ergonomics around SSH config, key management, and port-forwarding.

3. Control plane
   - Multi-tenant account, workspace, entitlement, quota, and audit management.
   - Template ingestion, build orchestration, image promotion, and runtime routing.
   - Session scheduling, wake/sleep logic, and cleanup.

4. Runtime plane
   - Isolated Cloudflare Containers that run developer images.
   - WebSocket-based SSH proxying through a Worker.
   - Optional browser-native access through HTTP/WebSocket tooling such as `code-server` or `ttyd`.
   - Workspace restore and snapshot persistence through R2.

## Primary Users

- Individual developers who need cheap, fast burst environments.
- Small teams that want shared, reproducible dev boxes without running infrastructure.
- Platform teams that need ephemeral debugging or test environments.
- CI and automation workloads that need short-lived remote execution with shell access.

## Core Product Principles

- Cloudflare-native: compute, storage, data, orchestration, auth enforcement, and delivery all run on Cloudflare.
- SSH-first: the platform must support real shell workflows, not just browser UIs.
- Zero-idle by default: sessions sleep automatically and storage is externalized.
- Account-centric: every action is attributable to a user, workspace, and policy.
- Template-driven: environments are standardized, versioned, and centrally managed.
- Production-safe: the design supports quotas, audit trails, usage accounting, and operational visibility from day one.

## Release Scope

The initial production release should include:

- Account system with passkeys, session management, device authorization for CLI, workspace membership, and role-based access.
- Web app for onboarding, template selection, session control, activity history, and in-browser access.
- CLI for login, session control, SSH attach, and privileged template management.
- Template storage in R2 with metadata in D1 and asynchronous server-side build/promotion workflows.
- Session orchestration using Workers, Durable Objects, and Cloudflare Containers.
- Workspace snapshot storage in R2 so a sleeping container can be recreated without relying on local container disk.
- Usage metering, quotas, and audit logs so the product can support paid plans or internal chargeback later.

## Product Boundaries

BurstFlare is not trying to replace a full local workstation or a deeply integrated monolithic IDE platform. The first release optimizes for fast, reproducible, burst compute with strong terminal workflows. Large-scale collaborative editing, marketplace ecosystems, enterprise billing automation, and deep Git provider integrations can come later.

## Success Criteria

The launch is successful when the product can reliably deliver:

- New user to first running session in under 10 minutes.
- Existing user to active shell in under 15 seconds for common templates.
- Automatic idle sleep with no data loss for supported persisted paths.
- Shared control plane support for both browser and CLI users.
- Safe multi-tenant isolation with clear auditability and quota enforcement.
