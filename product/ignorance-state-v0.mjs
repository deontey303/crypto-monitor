// Pre-FLOW ignorance-state classifier.
// SECURITY/CAUSALITY RULE: this module accepts only pre-FLOW features.
// Any FLOW-like field causes a hard failure rather than silent leakage.
export const IGNORANCE_STATES=['BREAKOUT','SPOT_PERP_CAUSE','JUMP','PRICE_DISCOVERY','QUIET'];
const FORBIDDEN=/(flow|ofi|cvd|aggress|taker|buy.?sell|spot.?imbalance|perp.?imbalance)/i;
export function assertPreFlow(features){
  for(const key of Object.keys(features)){
    if(FORBIDDEN.test(key)) throw new Error('flow_leakage:'+key);
    const v=features[key];
    if(v && typeof v==='object' && !Array.isArray(v)) assertPreFlow(v);
  }
  return features;
}
const n=(x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
export function classifyIgnorance(features){
  assertPreFlow(features);
  // v0 priority is frozen. Features are observable without trade-direction FLOW.
  const breakout=Math.abs(n(features.distanceFromRangeBps))<=n(features.breakoutBandBps,15)
    && n(features.rangeCompression01)>=0.6;
  const jump=n(features.realizedVolZ)>=2 || Math.abs(n(features.returnZ))>=2.5;
  const venueAmbiguity=n(features.crossVenueDispersionBps)>=n(features.venueDispersionThresholdBps,8);
  const causeAmbiguity=Math.abs(n(features.spotPerpBasisZ))>=1.5 || Math.abs(n(features.openInterestChangeZ))>=1.5;
  if(jump) return 'JUMP';
  if(breakout) return 'BREAKOUT';
  if(venueAmbiguity) return 'PRICE_DISCOVERY';
  if(causeAmbiguity) return 'SPOT_PERP_CAUSE';
  return 'QUIET';
}
export function freezeIgnoranceState({decisionId,createdAt,instrument,horizon,features}){
  const clean=assertPreFlow(structuredClone(features));
  return Object.freeze({decisionId,createdAt,instrument,horizon,state:classifyIgnorance(clean),
    featureSchemaVersion:'pre-flow-v0',features:Object.freeze(clean)});
}
