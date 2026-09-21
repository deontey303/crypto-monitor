import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalClaim,claimHash} from './claim-hash.mjs';

const claim={claim_id:'dex:btc:1',agent_id:'momentum-agent',model_version:'momentum-v1',source:'dex',asset_id:'btc',symbol:'BTC',created_at:1,direction:1,entry_price:60000,round_trip_cost_bps:20,baseline_model_version:'contrarian-v1'};

test('canonical form ignores object key order',async()=>{
  const reversed=Object.fromEntries(Object.entries(claim).reverse());
  assert.equal(canonicalClaim(claim),canonicalClaim(reversed));
  assert.equal(await claimHash(claim),await claimHash(reversed));
});

test('changing a committed field changes proof',async()=>{
  assert.notEqual(await claimHash(claim),await claimHash({...claim,direction:-1}));
});

test('rejects incomplete claim',()=>assert.throws(()=>canonicalClaim({...claim,entry_price:undefined}),/missing_entry_price/));
