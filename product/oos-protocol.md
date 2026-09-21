# ProofMarket OOS-001 — preregistration

Status: NOT STARTED. This file must be committed before observations used for the test are evaluated.

## Competing models
M1: momentum-v1 — follow the direction of the >=10% trigger.
M0: contrarian-v1 — take the opposite direction.

## Fixed horizons
15, 60, 240 minutes.

## Fixed transaction-cost assumption
Use the round-trip cost committed with each claim. Never change it after seeing an outcome.

## Primary endpoint
For each horizon separately:

paired_edge_bps = net_return_bps(momentum-v1) - net_return_bps(contrarian-v1)

Primary summary: mean paired_edge_bps.

## Required context
Report N evaluated, N missing, missing rate, mean/median paired edge, hit rates, and the worst observed model net return.

## Decision rule
This experiment is descriptive until a minimum of 100 evaluated claims exists at a horizon. At N >= 100, call the result supportive only when the 95% bootstrap confidence interval for mean paired edge excludes 0 in the positive direction. Negative exclusion supports M0. Otherwise: inconclusive.

No horizon switching: all three horizons are reported. No removal of losing claims. No model-version edits during the epoch.

## Failure modes that invalidate the epoch
Post-outcome claim mutation; unavailable provenance for entry/exit quote; scoring-code change without a new epoch; hidden deletion; baseline changed after commit.

## Product question
Separately from predictive performance, test whether users value verified precommitment. Predictive edge and willingness-to-pay are distinct hypotheses.
