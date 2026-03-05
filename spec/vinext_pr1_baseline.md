# Vinext Rewrite PR1 Baseline

## Purpose
Lock the current web behavior before the rewrite so each migration PR can be validated against stable expectations.

## Automated Baseline Checks
- Command: `npm run ui:smoke -- --base-url <target>`
- Script: `scripts/ui-smoke.ts`
- Current route coverage:
  - `/`
  - `/dashboard`
  - `/login`
  - `/profile`
  - `/docs`

## Required Route Markers
- Home (`/`):
  - `BurstFlare`
  - `Ship faster with reusable cloud workspaces.`
  - `Try the dashboard`
- Dashboard (`/dashboard`):
  - `Instances`
  - `Sessions`
  - `/home/flare`
  - `Create and start`
- Login (`/login`):
  - `Send Sign-In Code`
  - `Verify Code`
  - `Work email`
- Profile (`/profile`):
  - `Billing`
  - `Browser sessions`
  - `Add payment method`
- Docs (`/docs`):
  - `Instances`
  - `Sessions`
  - `Snapshots`
  - `Common state`

## Manual Visual Baseline
Capture screenshots before each migration PR for:
1. Home hero + top navigation
2. Dashboard instance/session forms and lists
3. Login screen state (email/code sections)
4. Profile billing and sessions blocks
5. Docs page content cards

Store screenshots under a PR artifact or linked issue for side-by-side review during rollout.

## Guardrails Added In PR1
- New `dangerouslySetInnerHTML` usage is blocked outside an explicit allowlist.
- New giant template-literal blobs are blocked (except temporary legacy allowlist files).
- Large utility `className` bundles in app routes are blocked to drive primitive/component composition.
