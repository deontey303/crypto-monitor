import {LiquidityResponseWindow} from './liquidity-response.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function persistMeasurement(DB,symbol,m){
 await DB.prepare(`INSERT INTO liquidity_response_measurements
  (symbol,measured_at,side,price,removed_qty,replenished_qty,lr,regime,sensor_version)
  VALUES (?,?,?,?,?,?,?,?,?)`).bind(symbol,m.ts,m.side,m.price,m.removedQty,m.replenishedQty,m.lr,m.regime,'lr-v1').run();
}
export async function startLiquidityResponseSensor(DB,{symbol=process.env.LR_SYMBOL||'btcusdt',
 windowMs=Number(process.env.LR_WINDOW_MS||1000),minAggressiveUsd=Number(process.env.LR_MIN_AGGRESSIVE_USD||10000)}={}){
 const sensor=new LiquidityResponseWindow({windowMs,minAggressiveUsd});
 let stopped=false;
 const url=`wss://fstream.binance.com/stream?streams=${symbol.toLowerCase()}@depth20@100ms/${symbol.toLowerCase()}@aggTrade`;
 while(!stopped){
  try{
   const ws=new WebSocket(url);
   await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});
   });
   await new Promise((resolve)=>{
    const timer=setInterval(async()=>{
     for(const m of sensor.flush(Date.now())) try{await persistMeasurement(DB,symbol.toUpperCase(),m);}catch(e){console.error('lr_persist_failed',e.message);}
    },Math.max(100,Math.min(500,windowMs/2)));
    ws.addEventListener('message',event=>{
     try{
      const x=JSON.parse(event.data).data;
      if(x.e==='depthUpdate'||(x.bids&&x.asks)) sensor.depth({ts:Number(x.E??Date.now()),bids:x.b??x.bids,asks:x.a??x.asks});
      else if(x.e==='aggTrade') sensor.trade({ts:Number(x.T??x.E),price:Number(x.p),qty:Number(x.q),buyerIsMaker:Boolean(x.m)});
     }catch{}
    });
    const end=()=>{clearInterval(timer);resolve();};ws.addEventListener('close',end,{once:true});ws.addEventListener('error',end,{once:true});
   });
  }catch(e){console.error('lr_stream_failed',e.message);}
  if(!stopped)await sleep(2000);
 }
 return ()=>{stopped=true;};
}
