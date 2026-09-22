import {createDB} from '../railway/db.mjs';
import {freezeIgnoranceState} from './ignorance-state-v0.mjs';
import {binanceFlow} from './binance-flow.mjs';
import {flowAction,makePolicies,scoreAction} from './flow-v0.mjs';
const H=[60,240], MIN=60000;
const j=async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('market_'+r.status);return r.json();};
const avg=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
function z(last,a){const m=avg(a),sd=Math.sqrt(avg(a.map(x=>(x-m)**2)))||1;return (last-m)/sd;}
export async function preFlowState(symbol){
 const [k,prem,oi]=await Promise.all([
  j('https://fapi.binance.com/fapi/v1/klines?symbol='+symbol+'&interval=5m&limit=30'),
  j('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+symbol),
  j('https://fapi.binance.com/futures/data/openInterestHist?symbol='+symbol+'&period=5m&limit=30')
 ]);
 const closes=k.map(x=>Number(x[4])), rets=closes.slice(1).map((x,i)=>Math.log(x/closes[i]));
 const ranges=k.map(x=>(Number(x[2])-Number(x[3]))/Number(x[4])*10000);
 const last=closes.at(-1), hi=Math.max(...k.slice(-12,-1).map(x=>Number(x[2]))),lo=Math.min(...k.slice(-12,-1).map(x=>Number(x[3])));
 const oiVals=oi.map(x=>Number(x.sumOpenInterest));
 return {price:last,features:{
  returnZ:z(rets.at(-1),rets.slice(0,-1)),realizedVolZ:z(ranges.at(-1),ranges.slice(0,-1)),
  distanceFromRangeBps:Math.min(Math.abs(last/hi-1),Math.abs(last/lo-1))*10000,
  breakoutBandBps:15,rangeCompression01:Math.max(0,Math.min(1,1-ranges.at(-1)/(avg(ranges.slice(-12,-1))||1))),
  spotPerpBasisZ:Number(prem.lastFundingRate||0)*10000,
  openInterestChangeZ:oiVals.length>2?z((oiVals.at(-1)/oiVals.at(-2)-1)*10000,oiVals.slice(1,-1).map((x,i)=>(x/oiVals[i]-1)*10000)):0,
  crossVenueDispersionBps:0,venueDispersionThresholdBps:8
 }};
}
const bidByState=s=>({pActionChange:{BREAKOUT:.5,SPOT_PERP_CAUSE:.6,JUMP:.55,PRICE_DISCOVERY:.5,QUIET:.1}[s],
 expectedLossAvoided:20,measurementCost:2,latencyCost:1,randomAcquisitionRate:.5});
export async function openDecision(db,symbol,now=Date.now(),randomUnit=Math.random()){
 const base=await preFlowState(symbol), id='vira:'+symbol+':'+now;
 const frozen=freezeIgnoranceState({decisionId:id,createdAt:now,instrument:symbol,horizon:'1h/4h',features:base.features});
 await db.prepare('INSERT INTO ignorance_states(decision_id,created_at,instrument,horizon,state,feature_schema_version,pre_flow_features_json) VALUES (?,?,?,?,?,?,?)')
  .bind(id,now,symbol,'1h/4h',frozen.state,frozen.featureSchemaVersion,JSON.stringify(frozen.features)).run();
 const policies=makePolicies({decisionId:id,ts:now,instrument:symbol,horizon:'1h/4h',preAction:'WAIT',
  hypotheses:['directional-flow-confirmation','flow-disagreement'],sensorBid:bidByState(frozen.state),randomUnit});
 // Acquire once if any policy requests it; policies that did not buy it are forbidden from using it.
 const need=policies.some(x=>x.acquire), flow=need?await binanceFlow(symbol):null, observed=flow?.observedAt??null;
 const actionMap=JSON.stringify({model:'flow-v0',long:'score>=0.20 & disagreement<0.35',short:'score<=-0.20 & disagreement<0.35',else:'WAIT'});
 for(const p of policies){
  const post=p.acquire&&flow?flowAction(flow):p.preAction, b=bidByState(frozen.state);
  await db.prepare(`INSERT INTO decision_measurements
   (measurement_id,decision_id,created_at,instrument,horizon,policy,pre_action,hypotheses_json,sensor_id,p_action_change,expected_loss_avoided,measurement_cost,latency_cost,ignorance_bid,action_map_json,observed_at,observed_value_json,post_action,entry_price)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(id+':'+p.policy,id,now,symbol,'1h/4h',p.policy,p.preAction,JSON.stringify(p.hypotheses),'FLOW',b.pActionChange,b.expectedLossAvoided,b.measurementCost,b.latencyCost,p.ignoranceBid??(b.pActionChange*b.expectedLossAvoided-b.measurementCost-b.latencyCost),actionMap,p.acquire?observed:null,p.acquire?JSON.stringify(flow):null,post,base.price).run();
 }
 for(const h of H) await db.prepare('INSERT INTO cognition_outcomes(decision_id,horizon_minutes,due_at,status) VALUES (?,?,?,?)').bind(id,h,now+h*MIN,'pending').run();
 return {decisionId:id,state:frozen.state,policies:policies.map(p=>({policy:p.policy,acquire:p.acquire})),flowAcquired:need};
}
export async function settleDue(db,now=Date.now(),onSettlement=null){
 const due=await db.prepare("SELECT decision_id,horizon_minutes FROM cognition_outcomes WHERE status='pending' AND due_at<=?").bind(now).all();
 for(const o of due.results??[]){
  const rows=(await db.prepare('SELECT policy,instrument,post_action,pre_action,entry_price,measurement_cost FROM decision_measurements WHERE decision_id=?').bind(o.decision_id).all()).results??[];
  if(!rows.length)continue;
  let price;
  try{const x=await j('https://fapi.binance.com/fapi/v1/ticker/price?symbol='+rows[0].instrument);price=Number(x.price);}catch{continue;}
  for(const r of rows){
   const val=scoreAction(r.post_action,Number(r.entry_price),price,20)-Number(r.measurement_cost||0);
   const pre=scoreAction(r.pre_action,Number(r.entry_price),price,20);
   await db.prepare('INSERT INTO cognition_policy_outcomes(decision_id,horizon_minutes,policy,exit_price,net_decision_value,counterfactual_pre_action_value) VALUES (?,?,?,?,?,?) ON CONFLICT(decision_id,horizon_minutes,policy) DO NOTHING')
    .bind(o.decision_id,o.horizon_minutes,r.policy,price,val,pre).run();
  }
  await db.prepare("UPDATE cognition_outcomes SET status='evaluated',evaluated_at=? WHERE decision_id=? AND horizon_minutes=? AND status='pending'").bind(now,o.decision_id,o.horizon_minutes).run();
  if(onSettlement) await onSettlement({decisionId:o.decision_id,horizonMinutes:o.horizon_minutes,evaluatedAt:now,exitPrice:price,policies:rows.map(r=>r.policy)});
 }
 return due.results?.length??0;
}
export async function runCycle({db=createDB(),symbols=(process.env.VIRA_SYMBOLS??'BTCUSDT,ETHUSDT,SOLUSDT').split(','),now=Date.now(),onSettlement=null}={}){
 await settleDue(db,now,onSettlement);const opened=[];for(const symbol of symbols)opened.push(await openDecision(db,symbol.trim(),now));return opened;
}
