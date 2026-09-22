import {flowMeasurement} from './flow-v0.mjs';
const json=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('binance_'+r.status);return r.json();};
export async function binanceFlow(symbol='BTCUSDT',limit=1000){
  // Public Binance USD-M futures aggregate trades: no account/API key required.
  const trades=await json('https://fapi.binance.com/fapi/v1/aggTrades?symbol='+encodeURIComponent(symbol)+'&limit='+limit);
  let perpBuy=0,perpSell=0;
  for(const t of trades){const q=Number(t.q)*Number(t.p); if(t.m) perpSell+=q; else perpBuy+=q;}
  // Binance spot aggregate trades provide a comparable aggressive-flow sample.
  const spot=await json('https://api.binance.com/api/v3/aggTrades?symbol='+encodeURIComponent(symbol)+'&limit='+limit);
  let spotBuy=0,spotSell=0;
  for(const t of spot){const q=Number(t.q)*Number(t.p); if(t.m) spotSell+=q; else spotBuy+=q;}
  return {sensor:'FLOW',symbol,observedAt:Date.now(),sample:{perpTrades:trades.length,spotTrades:spot.length},
    ...flowMeasurement({spotBuy,spotSell,perpBuy,perpSell})};
}
