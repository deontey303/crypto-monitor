import crypto from 'node:crypto';
const canon=x=>JSON.stringify(x,Object.keys(x).sort());
export const sha256=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const get=async url=>{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'crypto-monitor-dataset/1.0'},signal:AbortSignal.timeout(9000)});if(!r.ok)throw new Error('http_'+r.status);return r.json()};
const obs=async(source,url,project=x=>x)=>{const ingest=Date.now();try{return {source,status:'ok',ingest_time:ingest,data:project(await get(url))}}catch(e){return {source,status:'unavailable',ingest_time:ingest,error:String(e.message||e)}}};
export async function collectMarketState({symbol='BTCUSDT',now=Date.now()}={}){
 const hour=Math.floor(now/3600000)*3600000, closedBefore=hour;
 const [kl,depth,trades,oi,premium]=await Promise.all([
  obs('binance-usdm-klines',`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=120`,x=>x.filter(v=>+v[6]<closedBefore).map(v=>({open_time:+v[0],close_time:+v[6],o:+v[1],h:+v[2],l:+v[3],c:+v[4],volume:+v[5],quote_volume:+v[7],trades:+v[8]}))),
  obs('binance-usdm-depth',`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=1000`,x=>({lastUpdateId:x.lastUpdateId,E:x.E,T:x.T,bids:x.bids,asks:x.asks})),
  obs('binance-usdm-aggtrades',`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`,x=>x.map(v=>({id:v.a,p:+v.p,q:+v.q,first:v.f,last:v.l,T:v.T,buyerIsMaker:v.m}))),
  obs('binance-usdm-open-interest',`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,x=>({openInterest:+x.openInterest,time:+x.time})),
  obs('binance-usdm-premium',`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,x=>({markPrice:+x.markPrice,indexPrice:+x.indexPrice,lastFundingRate:+x.lastFundingRate,nextFundingTime:+x.nextFundingTime,time:+x.time}))
 ]);
 const raw={schema_version:'market-state-v1',symbol,event_time:now,closed_candle_cutoff:closedBefore,sources:{klines:kl,depth,trades,open_interest:oi,premium}};
 const freshness=Object.fromEntries(Object.entries(raw.sources).map(([k,v])=>[k,{status:v.status,ingest_time:v.ingest_time,age_ms:Math.max(0,now-v.ingest_time)}]));
 return {...raw,freshness,raw_hash:sha256(raw)};
}
export async function ensureMarketStateSchema(db){await db.exec(`CREATE TABLE IF NOT EXISTS market_state_snapshots(snapshot_id text PRIMARY KEY,symbol text NOT NULL,event_time bigint NOT NULL,created_at bigint NOT NULL,schema_version text NOT NULL,raw_hash text NOT NULL UNIQUE,payload_json text NOT NULL);CREATE INDEX IF NOT EXISTS market_state_time ON market_state_snapshots(symbol,event_time);CREATE OR REPLACE FUNCTION deny_market_state_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'market_state_snapshots immutable'; END $$;DROP TRIGGER IF EXISTS market_state_no_mutation ON market_state_snapshots;CREATE TRIGGER market_state_no_mutation BEFORE UPDATE OR DELETE ON market_state_snapshots FOR EACH ROW EXECUTE FUNCTION deny_market_state_mutation();`)}
export async function persistMarketState(db,state){const id='ms-'+state.raw_hash.slice(0,24);await db.prepare('INSERT INTO market_state_snapshots(snapshot_id,symbol,event_time,created_at,schema_version,raw_hash,payload_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(raw_hash) DO NOTHING').bind(id,state.symbol,state.event_time,Date.now(),state.schema_version,state.raw_hash,JSON.stringify(state)).run();console.log(JSON.stringify({checkpoint:'MARKET_STATE_SNAPSHOT_WRITTEN',snapshot_id:id,symbol:state.symbol,event_time:state.event_time,raw_hash:state.raw_hash,freshness:state.freshness}));return id}
