// Signal Agent v3: leakage-aware multi-scale microstructure feature layer.
// Shadow-only until prospective calibration demonstrates net improvement.
export const clamp=(x,a=-1,b=1)=>Math.max(a,Math.min(b,x));
const mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length);
const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};

export function microstructure({book, trades=[], oiSeries=[], fundingRate=0, basisBps=0}) {
  const bids=(book?.bids||[]).map(([p,q])=>[+p,+q]), asks=(book?.asks||[]).map(([p,q])=>[+p,+q]);
  if(!bids.length||!asks.length)return {status:'missing'};
  const mid=(bids[0][0]+asks[0][0])/2, spreadBps=(asks[0][0]-bids[0][0])/mid*1e4;
  const depth=(xs,n=20)=>xs.slice(0,n).reduce((s,x)=>s+x[1],0);
  const bidDepth=depth(bids),askDepth=depth(asks),bookImbalance=(bidDepth-askDepth)/(bidDepth+askDepth||1);
  const buy=trades.filter(x=>x.side==='buy').reduce((s,x)=>s+(+x.qty||0),0);
  const sell=trades.filter(x=>x.side==='sell').reduce((s,x)=>s+(+x.qty||0),0);
  const tradeImbalance=(buy-sell)/(buy+sell||1);
  const oi=oiSeries.map(Number).filter(Number.isFinite),oiDeltaBps=oi.length>1?(oi.at(-1)/oi[0]-1)*1e4:0;
  const toxicity=clamp(Math.abs(tradeImbalance)*.55+Math.abs(bookImbalance)*.45,0,1);
  return {status:'ok',mid,spreadBps,bookImbalance,tradeImbalance,oiDeltaBps,fundingRate,basisBps,toxicity};
}

// Lightweight online clustering: standardized distance to frozen interpretable regime centroids.
// Centroids are hypotheses, not learned truth; keep in shadow until fit on a versioned dataset.
const C={
 trend_up:[.8,.5,.5,.2,-.2],trend_down:[-.8,-.5,-.5,-.2,.2],
 squeeze:[.1,.2,.8,.8,.8],deleverage:[-.2,-.1,-.8,-.8,.6],balanced:[0,0,0,0,0]
};
export function regimeCluster({retZ=0,flow=0,oiZ=0,fundingZ=0,volZ=0}) {
  const x=[retZ,flow,oiZ,fundingZ,volZ];
  const d=Object.entries(C).map(([name,c])=>[name,Math.sqrt(mean(x.map((v,i)=>(v-c[i])**2)))])
    .sort((a,b)=>a[1]-b[1]);
  const margin=d[1][1]-d[0][1];
  return {cluster:d[0][0],distance:d[0][1],margin,uncertain:margin<.12};
}

export function multiScale(candles){
  const closes=candles.map(x=>+x.c), rets=closes.slice(1).map((x,i)=>Math.log(x/closes[i]));
  const z=(n)=>{const a=rets.slice(-n);return sd(a)?mean(a)/sd(a):0};
  const rv=(n)=>sd(rets.slice(-n))*Math.sqrt(n)*1e4;
  return {momentumZ:{short:z(12),medium:z(48),long:z(96)},realizedVolBps:{short:rv(12),medium:rv(48),long:rv(96)}};
}

export function opportunityGate({pLong,pShort,pFlat,expectedMoveBps,costBps,uncertainty,ood,regimeUncertain=false}){
  const p=Math.max(pLong,pShort),side=pLong>pShort?'LONG':'SHORT';
  const penalty=35*uncertainty+30*ood+(regimeUncertain?12:0);
  const netEdge=expectedMoveBps-costBps-penalty;
  const pass=p>=.58&&netEdge>12&&ood<.55;
  return {action:pass?side:'NO_TRADE',pLong,pShort,pFlat,netEdge,uncertainty,ood,calibration:'UNCALIBRATED_SHADOW'};
}

export function causalAblation(base, experts){
  const full=base(experts);
  const without=Object.fromEntries(Object.keys(experts).map(k=>[k,base({...experts,[k]:null})]));
  return {full,without,decisionCritical:Object.entries(without).filter(([,v])=>v.action!==full.action).map(([k])=>k)};
}
