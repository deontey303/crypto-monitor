# Railway Execution Contour Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run crypto-monitor on an isolated Railway + PostgreSQL execution contour while preserving the existing shadow-signal semantics and leaving GENESIS/genesis-core unchanged.

**Architecture:** Extract the environment-specific persistence boundary behind a small database adapter while retaining the current signal, cost, hashing, notification, and settlement semantics. Add a PostgreSQL schema and Railway entrypoints for scheduled collection and HTTP proof retrieval; create a separate Railway service backed by a separate PostgreSQL database.

**Tech Stack:** Node.js ESM, node:test, PostgreSQL, Railway services/cron, existing CoinMarketCap/DexScreener/Telegram integrations.

## Global Constraints
- Preserve the >=10% trigger, momentum-v1 vs contrarian-v1, 15/60/240 minute horizons, round-trip cost accounting, and claim hashing.
- No real-money trading or custody.
- Do not modify the existing Railway GENESIS/genesis-core service.
- OOS-000 success means one natural signal completes claim -> settlement with zero human intervention between those events; profitability is not the criterion.
- Do not tune model or thresholds during OOS-000.

---

### Task 1: Portable PostgreSQL persistence

**Files:**
- Create: `railway/db.mjs`
- Create: `railway/schema.sql`
- Create: `railway/db.test.mjs`
- Modify: `cloudflare/worker.mjs` only where needed to consume the adapter-compatible interface.

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: database methods matching the existing `env.DB.prepare(...).bind(...).run/first/all` and transactional batch semantics needed by the domain pipeline.

- [ ] Add focused tests for parameter binding, first/all/run, transaction rollback, uniqueness, immutable claims, immutable finalized outcomes, and outbox payload immutability.
- [ ] Run the focused tests; expected failure is missing PostgreSQL adapter/schema.
- [ ] Implement the adapter and PostgreSQL equivalents of current D1 tables, indexes, view, constraints, and triggers. Convert SQLite-only trigger syntax without weakening immutability.
- [ ] Run focused tests and existing Worker tests; all pass.
- [ ] Commit the independently passing persistence deliverable.

### Task 2: Railway runner and proof HTTP service

**Files:**
- Create: `railway/runner.mjs`
- Create: `railway/server.mjs`
- Create: `railway/app.test.mjs`
- Modify: `cloudflare/worker.mjs` to export the proof-query behavior or a shared function without changing current Cloudflare behavior.

**Interfaces:**
- Runner consumes `DATABASE_URL`, source selector, provider/Telegram variables; invokes the existing `run(source, env, now)`.
- HTTP service consumes `DATABASE_URL`; produces `GET /proof/:signal_id` with the existing `proofmarket-v1` JSON contract and a health endpoint.

- [ ] Add failing tests for one scheduled run, duplicate tick idempotency, 404 proof, proof ordering, and health response.
- [ ] Implement minimal runner/server; provider failures return non-zero runner status and never fabricate outcomes.
- [ ] Verify synthetic claim -> pending -> evaluated lifecycle and hash compatibility.
- [ ] Run all Node/Python tests.
- [ ] Commit the independently passing entrypoint deliverable.

### Task 3: Railway packaging and isolated infrastructure

**Files:**
- Create: `package.json` if repository root still lacks one, with only required runtime dependency and scripts.
- Create: `railway.json` or equivalent repository config only if required by the live Railway service configuration.
- Create/modify: deployment documentation with exact variable names and commands.

**Interfaces:**
- Produces a web service for proof retrieval plus scheduled runner(s), all using the isolated PostgreSQL database.
- Must not mutate service id `3b101394-db08-46b5-920f-806a39f87933` (genesis-core).

- [ ] Add a packaging/start smoke test.
- [ ] Create a separate Railway `crypto-monitor` service and PostgreSQL resource; bind `DATABASE_URL`.
- [ ] Configure required non-secret defaults to existing frozen values and configure secrets only from already-authorized available values; if a required secret is unavailable, stop at that gate rather than invent it.
- [ ] Apply schema, deploy, and verify health.
- [ ] Verify genesis-core source/config remains unchanged.
- [ ] Commit repository-side deployment configuration.

### Task 4: OOS-000 production verification

**Files:**
- No model changes.
- Evidence is the production database/proof endpoint and deployment logs.

**Interfaces:**
- Consumes the naturally occurring >=10% trigger.
- Produces an immutable claim followed by 15m/60m/240m outcomes and Telegram outbox delivery.

- [ ] Confirm the first claim existed before its first due outcome.
- [ ] Make no manual mutation between claim and settlement.
- [ ] Verify all three horizon records settle or become explicitly missing under the fixed grace rule.
- [ ] Recompute/verify claim hash and returns independently from stored fields.
- [ ] Record OOS-000 PASS only for autonomous lifecycle closure; do not infer alpha from one signal.
- [ ] Freeze implementation for subsequent untouched OOS sampling.

## Unresolved externally observable decisions
- Railway may require separate services for web and cron execution; if the live platform cannot attach multiple schedules/commands to one service cleanly, create isolated services sharing the same PostgreSQL database rather than changing semantics.
- Provider and Telegram secrets are not stored in the repository. If they are not already available in the authorized Railway/GitHub environment, deployment must stop and request them rather than substituting credentials.
