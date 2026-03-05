# Vinext Web App Rewrite Plan (PR-by-PR)

## Goal
Rewrite the web app on top of `vinext` with:
- SSR-first route rendering
- modularized, reusable UI and domain components
- zero inline mega-CSS strings and zero inline app bootstrap scripts
- maintainable data boundaries between server and client code

## Current State
- `apps/web` already runs on `vinext` (`dev/build/start` scripts and Vite config are present).
- The main issue is architecture: large inline styles (`apps/web/src/assets.ts`) and inline runtime script injection (`app/lib/app-script.ts`) make the app hard to evolve.

## Target Architecture
- Routes
  - `app/(marketing)/*` for home/docs/login pages
  - `app/(product)/*` for authenticated dashboard/profile
- Component modules
  - `app/components/primitives/*` (Button, Input, Card, Badge, Table, Dialog, Tabs)
  - `app/components/layout/*` (AppShell, TopNav, SectionHeader, EmptyState)
  - `app/components/domain/*` (instances, sessions, usage, billing, auth)
- Styling
  - `app/styles/tokens.css`, `app/styles/base.css`, `app/styles/utilities.css`
  - feature-scoped CSS modules per component where useful
- Data layer
  - `app/lib/server/api.ts` for SSR fetches to edge APIs
  - `app/lib/client/api.ts` for client mutations
  - shared typed DTOs in `app/lib/types.ts`
- SSR strategy
  - Server Components for initial page data and auth gating
  - Client Components only for interactive controls and live updates

## PR Plan

## PR 1: Foundation And Guardrails
Scope:
- Freeze current UX behavior with baseline screenshots and smoke checks.
- Add migration architecture doc references and route/component conventions.
- Add lint guardrails:
  - forbid `dangerouslySetInnerHTML` in app pages/components (except explicit allowlist)
  - forbid new giant string-CSS blobs in TS files

Acceptance:
- CI stays green.
- No functional changes yet.

## PR 2: SSR App Shell + Design Tokens
Scope:
- Create `app/styles/*` tokenized CSS and import from `app/layout.tsx`.
- Implement modular shell components (`AppShell`, `TopNav`, shared page scaffolds).
- Replace page-level inline `<style>` injection for one low-risk route (home) as proof.

Acceptance:
- Home route renders fully via SSR using modular components.
- No dependency on `apps/web/src/assets.ts` for migrated route.

## PR 3: API Client Split (Server vs Client)
Scope:
- Implement typed fetch wrappers:
  - `lib/server/api.ts` with server-safe calls and cookie/header forwarding
  - `lib/client/api.ts` with browser fetch helpers
- Add shared response/error normalization and types.
- Remove direct fetch logic from inline scripts for migrated routes.

Acceptance:
- Data calls are centralized and typed.
- SSR route can fetch initial data without inline script bootstrapping.

## PR 4: Auth And Session Boundary
Scope:
- Add auth helpers for SSR route guards (`requireAuth`, `getViewer`).
- Move login and profile pages to modular SSR + client form components.
- Standardize auth error states and redirect behavior.

Acceptance:
- `/login` and `/profile` run without inline style/script injection.
- Authenticated route protection is server-enforced.

## PR 5: Dashboard Rewrite - Read Surfaces
Scope:
- Rewrite dashboard read-only sections with SSR hydration:
  - identity summary
  - instances list
  - sessions list
  - usage summary
  - audit summary
- Introduce user-friendly usage cards/charts/tables (no raw JSON blocks).

Acceptance:
- Dashboard initial render is SSR and readable.
- Raw JSON dumps removed from primary UI.

## PR 6: Dashboard Rewrite - Mutations
Scope:
- Modular forms/actions for:
  - create instance
  - create/start/stop/restart/delete session
  - common-state push/pull
  - billing actions currently supported by API
- Add optimistic UI + toast/error boundaries in client components.

Acceptance:
- Existing workflows work from new modular dashboard.
- No global inline app script required.

## PR 7: Realtime/Runtime UX (WS Paths)
Scope:
- Build modular terminal/editor launch components.
- Handle runtime attach token fetch, connection state, reconnect messaging.
- Integrate new session idle semantics into UX copy/status badges.

Acceptance:
- Terminal/editor/SSH entry actions work from rewritten dashboard.
- Connection status and failure states are clear to users.

## PR 8: Docs + Marketing Consolidation
Scope:
- Rewrite docs/home marketing sections with shared content components.
- Remove duplicate page-specific style patterns.
- Ensure responsive layout parity.

Acceptance:
- All marketing/docs pages use shared primitives/layout modules.
- No regressions in route availability or metadata.

## PR 9: Remove Legacy Web Layer
Scope:
- Delete `apps/web/src/assets.ts` and `app/lib/app-script.ts`.
- Remove leftover legacy IDs/hooks used only by inline script approach.
- Clean dead CSS and obsolete helper code.

Acceptance:
- Legacy inline-style/script architecture fully removed.
- Build and test pass with only modular SSR architecture.

## PR 10: Hardening, Perf, And Rollout
Scope:
- Add targeted tests:
  - route smoke (SSR render checks)
  - dashboard interaction flows
  - auth guard coverage
- Perf pass:
  - reduce client bundle surface
  - verify no unnecessary client hydration
- Deployment checklist and rollback notes.

Acceptance:
- CI includes new web checks for rewritten flows.
- Production deploy runbook updated.

## Non-Goals
- Backend API redesign in this migration.
- New product features unrelated to web architecture rewrite.

## Exit Criteria
- All user-facing web routes migrated to modular SSR architecture.
- No dependency on legacy inline style/script system.
- Dashboard usage section is fully user-friendly and no longer raw JSON.
- Deployment and smoke tests pass on production after rollout.
