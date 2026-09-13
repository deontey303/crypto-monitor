import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {selectPair, compare, run} from './worker.mjs';
const minute=60000;
test('DEX excludes quote-side, wrong-chain and illiquid pools',()=>{
  const token={chain:'solana',address:'mint'};
  const valid={chainId:'solana',baseToken:{address:'mint'},pairAddress:'pool',priceUsd:'1',liquidity:{usd:15000}};
  assert.equal(selectPair([{...valid,baseToken:{address:'other'},liquidity:{usd:1e9}}, {...valid,chainId:'wrong'}, {...valid,liquidity:{usd:100}},valid],token),valid);
});
test('signals reject stale baseline and changed pool; cooldown expires',()=>{
  const now=100*minute, current={pool:{price:1.2}};
  const prior={ts:now-5*minute,data:JSON.stringify({pool:{price:1}})};
  assert.equal(compare(current,prior,{},now).alerts.length,1);
  assert.equal(compare(current,prior,{pool:now-minute},now).alerts.length,0);
  assert.equal(compare(current,prior,{pool:now-30*minute},now).alerts.length,1);
  assert.equal(compare(current,{...prior,ts:now-31*minute},{},now).alerts.length,0);
  assert.equal(compare({newPool:{price:2}},prior,{},now).alerts.length,0);
});
function database() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const prepare=(query)=>{
    let args=[];
    return {bind(...values){args=values;return this;},
      async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},
      async first(){return sql.prepare(query).get(...args)??null;}};
  };
  return {sql,DB:{prepare,async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
}
test('CMC pipeline persists, deduplicates ticks and stops before budget limit',async()=>{
  const {sql,DB}=database();
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({status:{credit_count:3,error_code:0},data:[{id:1,symbol:'BTC',quote:{USD:{price:calls===1?100:120}}}]});};
  const env={DB,CMC_API_KEY:'test-only',CMC_MONTHLY_BUDGET:'8',CMC_CALL_RESERVE:'5'};
  const now=Date.UTC(2026,8,13,0,2);
  try{
    await run('cmc',env,now);await run('cmc',env,now);
    assert.equal(calls,1);
    await run('cmc',env,now+15*minute);
    assert.equal(JSON.parse(sql.prepare('SELECT data FROM signals ORDER BY ts DESC LIMIT 1').get().data).length,1);
    await assert.rejects(run('cmc',env,now+30*minute));
    assert.equal(calls,2);
    assert.equal(sql.prepare('SELECT used FROM budget').get().used,6);
  }finally{globalThis.fetch=original;sql.close();}
});
