import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRouterInput} from './vira-minimal-worker.mjs';

test('Trial-001 exposes temporal and cross-source measurements as distinct information',()=>{
 const ri=buildRouterInput('d1',{action:'NO_TRADE',evidence:{change_bps:20,market_data:{source:'coinbase'}}});
 assert.deepEqual(ri.evidence_already_known,['btc_spot_price','source:coinbase']);
 const byId=Object.fromEntries(ri.candidate_measurements.map(x=>[x.sensor_id,x]));
 assert.deepEqual(byId.temporal_resample_after_5s.information_tags,['btc_spot_price','temporal_price_change']);
 assert.deepEqual(byId.cross_source_confirmation.information_tags,['btc_spot_price','cross_source_price_confirmation']);
 assert.equal(byId.cross_source_confirmation.exclude_source,'coinbase');
});
