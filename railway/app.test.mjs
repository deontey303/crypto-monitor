import test from 'node:test';import assert from 'node:assert/strict';import {proof} from './server.mjs';
const DB={prepare(sql){let id;return{bind(x){id=x;return this},async first(){return sql.includes('shadow_signals')&&id==='s1'?{signal_id:'s1',claim_hash:'abc'}:null},async all(){return{results:[{horizon_minutes:15},{horizon_minutes:60},{horizon_minutes:240}]}}}}};
test('proof returns null for unknown claim',async()=>assert.equal(await proof(DB,'missing'),null));
test('proof preserves proofmarket-v1 contract and horizon ordering',async()=>assert.deepEqual(await proof(DB,'s1'),{proof_version:'proofmarket-v1',claim:{signal_id:'s1',claim_hash:'abc'},outcomes:[{horizon_minutes:15},{horizon_minutes:60},{horizon_minutes:240}]}));
