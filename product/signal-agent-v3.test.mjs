import test from 'node:test';import assert from 'node:assert/strict';
import {microstructure,regimeCluster,opportunityGate,causalAblation} from './signal-agent-v3.mjs';
test('book imbalance preserves direction',()=>{const x=microstructure({book:{bids:[[100,8],[99,4]],asks:[[101,2],[102,2]]}});assert(x.bookImbalance>.4);assert(x.spreadBps>0)});
test('cluster can abstain on ambiguous regime',()=>{const x=regimeCluster({retZ:0,flow:0,oiZ:0,fundingZ:0,volZ:0});assert.equal(x.cluster,'balanced')});
test('gate charges uncertainty and costs',()=>{assert.equal(opportunityGate({pLong:.7,pShort:.2,pFlat:.1,expectedMoveBps:25,costBps:8,uncertainty:.5,ood:.2}).action,'NO_TRADE')});
test('ablation names decision-critical expert',()=>{const base=e=>({action:(e.flow||0)+(e.price||0)>1?'LONG':'NO_TRADE'});const x=causalAblation(base,{flow:1,price:.2});assert.deepEqual(x.decisionCritical,['flow'])});
