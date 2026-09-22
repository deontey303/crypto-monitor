import {test} from 'node:test';import assert from 'node:assert/strict';
import {classifyIgnorance,freezeIgnoranceState} from './ignorance-state-v0.mjs';
test('classifies only from pre-FLOW observables',()=>{
 assert.equal(classifyIgnorance({realizedVolZ:2.1}),'JUMP');
 assert.equal(classifyIgnorance({distanceFromRangeBps:4,breakoutBandBps:15,rangeCompression01:.8}),'BREAKOUT');
 assert.equal(classifyIgnorance({crossVenueDispersionBps:12,venueDispersionThresholdBps:8}),'PRICE_DISCOVERY');
 assert.equal(classifyIgnorance({spotPerpBasisZ:1.7}),'SPOT_PERP_CAUSE');
 assert.equal(classifyIgnorance({realizedVolZ:.2,returnZ:.1}),'QUIET');
});
test('hard-fails on direct or nested FLOW leakage',()=>{
 assert.throws(()=>classifyIgnorance({flowScore:.2}),/flow_leakage/);
 assert.throws(()=>classifyIgnorance({nested:{takerBuySellRatio:1.2}}),/flow_leakage/);
});
test('freezes state before FLOW acquisition',()=>{
 const x=freezeIgnoranceState({decisionId:'d1',createdAt:1,instrument:'BTCUSDT',horizon:'1h',features:{spotPerpBasisZ:2}});
 assert.equal(x.state,'SPOT_PERP_CAUSE');assert.equal(x.featureSchemaVersion,'pre-flow-v0');
});
