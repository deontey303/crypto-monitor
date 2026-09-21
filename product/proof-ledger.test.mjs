import test from 'node:test';
import assert from 'node:assert/strict';
import {commitClaim,resolveClaim,verifyRecord} from './proof-ledger.mjs';

const base={claim_id:'c1',agent_id:'momentum-agent',model_version:'momentum-v1',source:'dex',asset_id:'btc',symbol:'BTC',created_at:1,direction:1,entry_price:60000,round_trip_cost_bps:20,baseline_model_version:'contrarian-v1'};
const memory=()=>{const m=new Map();return {get:k=>m.get(k),put:(k,v)=>m.set(k,structuredClone(v))}};

test('commit is independently verifiable',async()=>{const s=memory();const r=await commitClaim(s,base);assert.equal(await verifyRecord(r),true)});
test('duplicate claim cannot rewrite history',async()=>{const s=memory();await commitClaim(s,base);await assert.rejects(()=>commitClaim(s,{...base,direction:-1}),/claim_exists/)});
test('outcome finalizes once',async()=>{const s=memory();await commitClaim(s,base);await resolveClaim(s,'c1',15,{status:'evaluated',exit_price:61000,net_return_bps:146.67});await assert.rejects(()=>resolveClaim(s,'c1',15,{status:'missing'}),/outcome_finalized/)});
test('tampering breaks verification',async()=>{const s=memory();const r=await commitClaim(s,base);r.claim.direction=-1;assert.equal(await verifyRecord(r),false)});
