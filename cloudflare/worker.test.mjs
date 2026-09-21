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
      async first(){return sql.prepare(query).get(...args)??null;},
      async all(){return {results:sql.prepare(query).all(...args)};}};
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

// Catches future leakage: a decision must exist with pending horizons before any
// post-entry price can be attached, and only due horizons may be evaluated.
test('shadow signal is immutable and receives forward outcomes only when due',async()=>{
  const {sql,DB}=database();
  const original=globalThis.fetch;let price=100;
  globalThis.fetch=async()=>Response.json({status:{credit_count:1,error_code:0},data:[
    {id:1,symbol:'BTC',quote:{USD:{price,market_cap:1e12,volume_24h:1e9}}}
  ]});
  const env={DB,CMC_API_KEY:'test-only',CMC_MONTHLY_BUDGET:'100',CMC_CALL_RESERVE:'5',SHADOW_ROUND_TRIP_COST_BPS:'20'};
  const start=Date.UTC(2026,8,13,0,2);
  try{
    await run('cmc',env,start);
    price=120;
    await run('cmc',env,start+15*minute);

    const decision=sql.prepare('SELECT direction,baseline_direction,entry_price,trigger_change_pct,round_trip_cost_bps,model_version FROM shadow_signals').get();
    assert.deepEqual({...decision},{direction:1,baseline_direction:-1,entry_price:120,trigger_change_pct:20,round_trip_cost_bps:20,model_version:'momentum-v1'});
    assert.deepEqual(sql.prepare('SELECT horizon_minutes,status FROM shadow_outcomes ORDER BY horizon_minutes').all().map(row=>({...row})),[
      {horizon_minutes:15,status:'pending'},
      {horizon_minutes:60,status:'pending'},
      {horizon_minutes:240,status:'pending'}
    ]);
    assert.throws(()=>sql.prepare('UPDATE shadow_signals SET direction=-1').run(),/immutable/);

    price=132;
    await run('cmc',env,start+30*minute);
    const outcomes=sql.prepare('SELECT horizon_minutes,status,gross_return_bps,net_return_bps,baseline_net_return_bps FROM shadow_outcomes ORDER BY horizon_minutes').all().map(row=>({...row}));
    assert.deepEqual(outcomes,[
      {horizon_minutes:15,status:'evaluated',gross_return_bps:1000,net_return_bps:980,baseline_net_return_bps:-1020},
      {horizon_minutes:60,status:'pending',gross_return_bps:null,net_return_bps:null,baseline_net_return_bps:null},
      {horizon_minutes:240,status:'pending',gross_return_bps:null,net_return_bps:null,baseline_net_return_bps:null}
    ]);
  }finally{globalThis.fetch=original;sql.close();}
});

// Catches survivorship bias: a vanished asset must become an explicit missing
// outcome after the fixed grace window instead of remaining pending forever.
test('overdue outcome is marked missing when its asset has no quote',async()=>{
  const {sql,DB}=database();
  const original=globalThis.fetch;
  let coins=[
    {id:1,symbol:'BTC',quote:{USD:{price:100}}},
    {id:2,symbol:'ETH',quote:{USD:{price:100}}}
  ];
  globalThis.fetch=async()=>Response.json({status:{credit_count:1,error_code:0},data:coins});
  const env={DB,CMC_API_KEY:'test-only',CMC_MONTHLY_BUDGET:'100',CMC_CALL_RESERVE:'5',SHADOW_ROUND_TRIP_COST_BPS:'20'};
  const start=Date.UTC(2026,8,13,0,2);
  try{
    await run('cmc',env,start);
    coins=[
      {id:1,symbol:'BTC',quote:{USD:{price:120}}},
      {id:2,symbol:'ETH',quote:{USD:{price:100}}}
    ];
    await run('cmc',env,start+15*minute);
    coins=[{id:2,symbol:'ETH',quote:{USD:{price:100}}}];
    await run('cmc',env,start+75*minute);
    assert.deepEqual({...sql.prepare(`SELECT status,missing_reason FROM shadow_outcomes
      WHERE horizon_minutes=15`).get()},{status:'missing',missing_reason:'quote_unavailable'});
    assert.equal(sql.prepare(`SELECT status FROM shadow_outcomes WHERE horizon_minutes=60`).get().status,'pending');
  }finally{globalThis.fetch=original;sql.close();}
});

// Catches delivery/data coupling and duplicate sends: a Telegram outage must not
// roll back the signal, and the durable outbox must retry it on the next tick.
test('Telegram outbox retries without duplicating shadow signals',async()=>{
  const {sql,DB}=database();
  const original=globalThis.fetch;
  let price=100, telegramCalls=0;
  globalThis.fetch=async(url,options)=>{
    if (String(url).startsWith('https://api.telegram.org/')) {
      telegramCalls++;
      assert.equal(JSON.parse(options.body).chat_id,'42');
      if (telegramCalls===1) return new Response('unavailable',{status:503});
      return Response.json({ok:true,result:{message_id:telegramCalls}});
    }
    return Response.json({status:{credit_count:1,error_code:0},data:[
      {id:1,symbol:'BTC',quote:{USD:{price}}}
    ]});
  };
  const env={DB,CMC_API_KEY:'test-only',CMC_MONTHLY_BUDGET:'100',CMC_CALL_RESERVE:'5',
    SHADOW_ROUND_TRIP_COST_BPS:'20',TELEGRAM_BOT_TOKEN:'secret-test-token',TELEGRAM_CHAT_ID:'42'};
  const start=Date.UTC(2026,8,13,0,2);
  try{
    await run('cmc',env,start);
    price=120;
    await run('cmc',env,start+15*minute);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM shadow_signals').get().n,1);
    assert.deepEqual({...sql.prepare('SELECT status,attempts FROM notification_outbox').get()},
      {status:'pending',attempts:1});

    price=132;
    await run('cmc',env,start+30*minute);
    assert.equal(telegramCalls,3);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM notification_outbox').get().n,2);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM notification_outbox WHERE status='sent'").get().n,2);
    assert.equal(sql.prepare("SELECT attempts FROM notification_outbox WHERE kind='signal'").get().attempts,2);
  }finally{globalThis.fetch=original;sql.close();}
});
