# ProofMarket Crypto Alpha — MVP

## Thesis
Crypto signals are cheap to generate and expensive to trust. The product is not another signal bot; it is a **proof layer for machine-generated alpha**.

Every prediction is committed before its outcome, immutable after commit, evaluated on fixed horizons, charged explicit costs, and compared with a declared baseline.

## Primary user
A trader, research desk, or agent builder deciding whether an AI signal source deserves attention or capital.

## Core object: Claim
A claim is a machine-verifiable prediction:

- unique claim id
- agent id + model version
- asset/source
- timestamp and entry price
- LONG/SHORT direction
- trigger/evidence metadata
- 15m / 1h / 4h horizons
- round-trip cost assumption
- baseline model
- canonical payload hash

The hash is the public commitment. Changing any committed field changes the hash.

## Verification contract
1. Commit before outcome.
2. Never update/delete committed claims.
3. Resolve only after the horizon.
4. Missing quotes are explicit missing outcomes, never silently dropped.
5. Score net of declared costs.
6. Compare against the baseline fixed at commit time.
7. Keep model versions immutable across a test epoch.

## MVP metric
Primary: mean paired edge in basis points versus the predeclared baseline.

Guardrails: sample count, missing-rate, hit-rate, median edge and maximum adverse result. No claim of alpha before an independently held-out epoch.

## Business model to test
Free: public delayed proof ledger and scorecard.
Paid: real-time verified claims, API/webhooks, model-specific history.
B2B: verification API for third-party AI agents and signal sellers.

Do not issue a token in MVP. First test whether cryptographic precommitment + independent scoring increases willingness to pay.

## Falsification
Kill or change the thesis if prospective users do not value verifiable precommitment over ordinary signal feeds, or if the model fails to beat its fixed baseline after costs on a preregistered OOS epoch.
