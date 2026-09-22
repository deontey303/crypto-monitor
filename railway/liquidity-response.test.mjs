import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiquidityResponseWindow} from './liquidity-response.mjs';

test('L_R measures bid replenishment after aggressive sell removes visible bid',()=>{
  const s=new LiquidityResponseWindow({windowMs:1000,minAggressiveUsd:1000});
  s.depth({ts:0,bids:[[100,5],[99,5]],asks:[[101,5],[102,5]]});
  s.trade({ts:100,price:100,qty:3,buyerIsMaker:true});
  s.depth({ts:200,bids:[[100,2],[99,5]],asks:[[101,5],[102,5]]});
  s.depth({ts:900,bids:[[100,4],[99,5]],asks:[[101,5],[102,5]]});
  const out=s.flush(1200);
  assert.equal(out.length,1);
  assert.equal(out[0].side,'sell');
  assert.equal(out[0].removedQty,3);
  assert.equal(out[0].replenishedQty,2);
  assert.equal(out[0].lr,2/3);
});

test('L_R ignores sub-threshold pressure and never uses future depth before the trade',()=>{
  const s=new LiquidityResponseWindow({windowMs:1000,minAggressiveUsd:1000});
  s.depth({ts:0,bids:[[100,10]],asks:[[101,10]]});
  s.trade({ts:100,price:100,qty:1,buyerIsMaker:true});
  s.depth({ts:200,bids:[[100,20]],asks:[[101,10]]});
  assert.deepEqual(s.flush(2000),[]);
});

test('decision is frozen from completed measurement window',()=>{
  const s=new LiquidityResponseWindow({windowMs:1000,minAggressiveUsd:1000});
  s.depth({ts:0,bids:[[100,5]],asks:[[101,5]]});
  s.trade({ts:100,price:100,qty:4,buyerIsMaker:true});
  s.depth({ts:900,bids:[[100,5]],asks:[[101,5]]});
  const [m]=s.flush(1200);
  assert.equal(m.lr,1);
  assert.equal(m.regime,'absorption');
});
