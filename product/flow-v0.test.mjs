import {test} from 'node:test';
import assert from 'node:assert/strict';
import {flowMeasurement,flowAction,makePolicies,scoreAction} from './flow-v0.mjs';
test('FLOW distinguishes aligned aggression from cross-market disagreement',()=>{
 const aligned=flowMeasurement({spotBuy:80,spotSell:20,perpBuy:75,perpSell:25});
 assert.equal(flowAction(aligned),'LONG');
 const disagree=flowMeasurement({spotBuy:80,spotSell:20,perpBuy:20,perpSell:80});
 assert.equal(flowAction(disagree),'WAIT');
});
test('IG, ALWAYS and RANDOM share opportunity but differ only in acquisition policy',()=>{
 const p=makePolicies({decisionId:'d',ts:1,instrument:'BTCUSDT',horizon:'1h',
  sensorBid:{pActionChange:.5,expectedLossAvoided:20,measurementCost:2,latencyCost:1,randomAcquisitionRate:.5},randomUnit:.7});
 assert.deepEqual(p.map(x=>[x.policy,x.acquire]),[['ig',true],['always',true],['random',false]]);
});
test('outcome scoring includes round-trip cost and abstention value',()=>{
 assert.equal(scoreAction('WAIT',100,120,20),0);
 assert.equal(Math.round(scoreAction('LONG',100,110,20)),980);
 assert.equal(Math.round(scoreAction('SHORT',100,110,20)),-1020);
});
