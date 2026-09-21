# Railway execution contour design

Date: 2026-09-21
Status: approved for spec commit; implementation requires post-spec review

## Goal
Run crypto-monitor as an isolated Railway service without changing the existing GENESIS/genesis-core service and without changing trading semantics.

## Invariants
- Preserve the >=10% trigger.
- Preserve momentum-v1 versus contrarian-v1.
- Preserve 15m / 60m / 240m settlement horizons.
- Preserve round-trip cost accounting and claim hashing.
- No real-money trading.
- A deployment must not alter genesis-core.

## Architecture
Create a new Railway service named crypto-monitor sourced from deontey303/crypto-monitor.

Replace only infrastructure-specific boundaries:
- Cloudflare D1 -> PostgreSQL via DATABASE_URL.
- Cloudflare scheduled(event) -> an explicit runner command invoked by Railway Cron.
- Worker fetch /proof/:id -> a small HTTP proof endpoint backed by PostgreSQL.
- Worker secrets -> Railway environment variables.

The signal/settlement logic remains semantically identical.

## Components
1. Core domain module: quote comparison, signal construction, claim hash, settlement math.
2. PostgreSQL repository adapter: runs, snapshots, state, signals, shadow_signals, shadow_outcomes, notification_outbox, budget.
3. Scheduled runner: accepts a source (dex/cmc), obtains quotes, commits claims before outcomes, settles due outcomes, and flushes Telegram outbox.
4. Proof HTTP service: GET /proof/:signal_id returns proofmarket-v1 claim and ordered outcomes.
5. Migration: creates PostgreSQL schema idempotently.

## Scheduling
Use Railway scheduled jobs at the existing cadence. Runs remain idempotent through source+time-bucket uniqueness. Duplicate scheduler invocations must not create duplicate claims or settlements.

## Secrets / configuration
Required at runtime as applicable:
- DATABASE_URL
- CMC_API_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Existing economic/model configuration remains frozen for the first autonomous test.

## Failure behavior
- Provider failures do not fabricate quotes or outcomes.
- Missing exit quotes become missing only after the existing grace period.
- Telegram failure leaves an outbox item retryable.
- Database writes preserve pre-outcome commitment ordering.
- No automatic model/threshold changes after failures.

## Verification
Before production:
1. Existing tests remain green.
2. Add adapter tests for PostgreSQL-facing interfaces with deterministic fixtures.
3. Verify claim hash compatibility with the current implementation.
4. Verify duplicate scheduled runs are idempotent.
5. Verify a synthetic lifecycle: precommitted claim -> pending horizons -> settlement -> proof response.
6. Verify genesis-core configuration is unchanged.

## First production experiment: OOS-000
Success is NOT profitable trading. Success is one naturally triggered signal that completes:
market observation -> prediction -> immutable claim -> wait -> 15m/60m/240m settlement -> proof
with zero human intervention between claim and settlement.

A losing signal can PASS OOS-000.

After OOS-000, freeze the implementation and collect an untouched OOS sample before evaluating trading edge after costs.

## Non-goals
- No threshold tuning.
- No prompt optimization.
- No exchange execution or custody.
- No real capital.
- No redesign of ProofMarket.
- No changes to GENESIS/genesis-core.
