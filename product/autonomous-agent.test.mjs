import test from 'node:test';import assert from 'node:assert/strict';import {technical,fuse,rsi} from './autonomous-agent.mjs';
const candles=(n=80,step=10)=>Array.from({length:n},(_,i)=>({o:10000+i*step,h:10020+i*step,l:9980+i*step,c:10000+i*step,v:1}));
test('rsi detects monotone strength',()=>assert.ok(rsi(candles().map(x=>x.c))>90));
test('technical produces bullish score for rising series',()=>assert.ok(technical(candles()).score>=2));
test('fusion can abstain',()=>assert.equal(fuse({tech:{score:0},derivatives:{fundingRate:0}}).action,'NO_TRADE'));
test('fusion emits long on strong evidence',()=>assert.equal(fuse({tech:{score:3},derivatives:{fundingRate:0}}).action,'LONG'));
