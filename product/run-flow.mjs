import {binanceFlow} from './binance-flow.mjs';
const symbols=(process.env.VIRA_SYMBOLS??'BTCUSDT,ETHUSDT,SOLUSDT').split(',').map(x=>x.trim()).filter(Boolean);
for(const symbol of symbols){
 try{console.log(JSON.stringify(await binanceFlow(symbol)));}
 catch(e){console.error(JSON.stringify({sensor:'FLOW',symbol,status:'error',error:String(e.message??e)}));process.exitCode=1;}
}
