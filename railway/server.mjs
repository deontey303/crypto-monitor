import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createDB} from './db.mjs';
import {startLiquidityResponseSensor} from './lr-live.mjs';
export async function proof(DB,signalId){
 const signal=await DB.prepare(`SELECT signal_id,agent_id,claim_hash,source,asset_id,symbol,created_at,direction,entry_price,round_trip_cost_bps,model_version,baseline_model_version FROM shadow_signals WHERE signal_id=?`).bind(signalId).first();
 if(!signal)return null;
 const outcomes=await DB.prepare(`SELECT horizon_minutes,due_at,status,evaluated_at,exit_price,net_return_bps,baseline_net_return_bps,missing_reason FROM shadow_outcomes WHERE signal_id=? ORDER BY horizon_minutes`).bind(signalId).all();
 return {proof_version:'proofmarket-v1',claim:signal,outcomes:outcomes.results??[]};
}
export function handler(DB){
 return async(req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);return res.end('Method not allowed');}
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true}));}
  const m=req.url?.match(/^\/proof\/([^/?]+)$/);if(!m){res.writeHead(404);return res.end('Not found');}
  const body=await proof(DB,decodeURIComponent(m[1]));if(!body){res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({error:'claim_not_found'}));}
  res.writeHead(200,{'content-type':'application/json','cache-control':'public, max-age=60'});res.end(JSON.stringify(body));
 };
}
if(import.meta.url===`file://${process.argv[1]}`){
 const DB=createDB();await DB.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 if(process.env.LR_ENABLED==='1') startLiquidityResponseSensor(DB).catch(e=>console.error('lr_sensor_stopped',e.message));
 const server=http.createServer((req,res)=>handler(DB)(req,res).catch(()=>{res.writeHead(500);res.end('Internal error');}));
 server.listen(Number(process.env.PORT||3000),'0.0.0.0');
}
