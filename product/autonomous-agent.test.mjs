import test from 'node:test';import assert from 'node:assert/strict';import {technical,fuse,rsi,ablations} from './autonomous-agent.mjs';
const c=(n=80,s=10)=>Array.from({length:n},(_,i)=>({o:1e4+i*s,h:10020+i*s,l:9980+i*s,c:1e4+i*s,v:1}));
test('rsi strength',()=>assert.ok(rsi(c().map(x=>x.c))>90));
test('technical rising',()=>assert.ok(technical(c()).score>=2));
test('fusion abstains',()=>assert.equal(fuse({technical:0,derivatives:0,macro:0,onchain:0,fundamental:0,news:0}).action,'NO_TRADE'));
test('ablation changes score exactly by removed family',()=>{const a=ablations({technical:3,derivatives:-.5,macro:.25,onchain:0,fundamental:.25,news:0});assert.equal(a.technical.deltaScore,3);assert.equal(a.FULL.score,3);});
