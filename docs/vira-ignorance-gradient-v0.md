# VIRA Ignorance Gradient v0

Status: PROPOSED / PROSPECTIVE. This protocol does not claim trading edge.

## Objective

Allocate finite observation budget to the missing information with the largest expected decision value, rather than collecting every available indicator.

At each decision time the action set is:

`LONG | SHORT | WAIT | ACQUIRE(sensor) | NO_TRADE`

## State and competing explanations

Freeze the currently observed state X and at least two mechanistically different explanations H.

For futures the initial sensor families are deliberately small:

- FLOW: aggressive spot/perp order flow and price-flow disagreement.
- LEVERAGE: open-interest change, funding/basis and leverage-price disagreement.
- LIQUIDITY: spread/depth plus forced-liquidation topology where available.
- CROSS_VENUE: venue disagreement and price-discovery leadership.
- SHOCK: fresh macro/news event state.

Do not add a sensor because it is available. It must compete for observation budget.

## Ignorance bid

For every missing sensor z, estimate before acquisition:

`IG(z) = P(action changes | z) * ExpectedLossAvoided(z) - MeasurementCost(z) - LatencyCost(z)`

This is an operational proxy for value of information, not a calibrated probability claim until calibration evidence exists.

Select only the highest positive bid. If all bids are <= 0, do not acquire more data.

## Decision gate

1. Freeze X, candidate action, alternative action, and hypotheses.
2. Identify the smallest missing measurement that could discriminate them.
3. Freeze the expected action under coarse outcome bins of that measurement.
4. Acquire exactly one winning sensor.
5. If the realized measurement does not cross a pre-frozen decision boundary, retain the old action.
6. If it crosses, record the changed action and why.
7. If uncertainty remains decision-sensitive and another sensor has positive IG, repeat; otherwise WAIT/NO_TRADE.
8. Never move entry, stop, target, or hypothesis after outcome data arrives.

## Prospective ledger

Every acquisition writes:

- decision_id / timestamp
- instrument / horizon
- pre_measurement_action
- competing_hypotheses
- sensor_requested
- sensor_cost and latency
- frozen action map / decision boundary
- observed sensor value
- post_measurement_action
- whether action_changed
- later net outcome after fees/slippage
- counterfactual outcome of the frozen pre-measurement action where computable

## Primary test

The new mechanism passes only if, on unseen prospective decisions:

`NetDecisionValue(IG policy) > NetDecisionValue(fixed sensor stack)`

and

`NetDecisionValue(IG policy) > NetDecisionValue(random sensor with equal observation budget)`.

Report uncertainty; do not inherit the mechanism from a small favorable sample.

## Causal sensor credit

A sensor gets credit only when all are true:

1. it was selected before its value was observed;
2. its action map was frozen before acquisition;
3. it actually changed the action or justified abstention at the frozen boundary;
4. the changed decision is scored on future outcome;
5. ablation/random-budget baselines do worse prospectively.

Information that merely improves a post-hoc explanation receives zero trading credit.

## First implementation target

Do not replace the existing immutable shadow ledger. Add a parallel `decision_measurements` ledger and start with one cheap public futures sensor family. FLOW is the first candidate because recent peer-reviewed evidence supports out-of-sample predictive information in crypto order flow, while that evidence is at daily/weekly horizons and therefore must NOT be assumed to transfer to our 15m/1h/4h futures horizon.

The first live experiment is therefore not “trade on order flow”. It is:

**Does selectively acquiring FLOW only when its pre-registered ignorance bid is positive improve prospective 1h/4h net decision value versus always acquiring FLOW and versus an equal-budget random acquisition policy?**

## Failure conditions

Reject or redesign v0 if:
- sensor selection uses the sensor value before the bid is frozen;
- action boundaries are adjusted after observation;
- missing data is silently discarded;
- transaction/latency costs are omitted;
- the fixed/random baselines are not evaluated on the same opportunities;
- gains disappear OOS or under reasonable cost assumptions.
