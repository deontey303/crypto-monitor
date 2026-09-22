import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinateSignal} from './worker.mjs';
test('coordinator emits LONG for valid positive move',()=>{assert.equal(coordinateSignal({price:100,change:12,liquidity:50000,volume24h:100000}).action,'LONG')});
test('coordinator emits SHORT for valid negative move',()=>{assert.equal(coordinateSignal({price:100,change:-12,liquidity:50000,volume24h:100000}).action,'SHORT')});
test('critic vetoes extreme moves',()=>{const x=coordinateSignal({price:100,change:40,liquidity:50000});assert.equal(x.action,'NO_TRADE');assert.equal(x.critic.veto,true)});
test('critic vetoes thin liquidity',()=>{assert.equal(coordinateSignal({price:100,change:12,liquidity:12000}).action,'NO_TRADE')});
