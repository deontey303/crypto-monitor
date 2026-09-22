const sumAtOrBelow=(levels,price)=>levels.reduce((n,[p,q])=>Number(p)<=price?n+Number(q):n,0);
const sumAtOrAbove=(levels,price)=>levels.reduce((n,[p,q])=>Number(p)>=price?n+Number(q):n,0);
export class LiquidityResponseWindow{
 constructor({windowMs=1000,minAggressiveUsd=10000}={}){
  this.windowMs=windowMs;this.minAggressiveUsd=minAggressiveUsd;this.book=null;this.pending=[];
 }
 depth({ts,bids,asks}){
  this.book={ts,bids:bids.map(x=>x.map(Number)),asks:asks.map(x=>x.map(Number))};
  for(const p of this.pending) if(ts>=p.tradeTs&&ts<=p.dueAt) p.lastBook=this.book;
 }
 trade({ts,price,qty,buyerIsMaker}){
  if(!this.book||this.book.ts>ts||Number(price)*Number(qty)<this.minAggressiveUsd)return;
  const side=buyerIsMaker?'sell':'buy', p=Number(price), q=Number(qty);
  const visible=side==='sell'?sumAtOrBelow(this.book.bids,p):sumAtOrAbove(this.book.asks,p);
  this.pending.push({side,tradeTs:ts,dueAt:ts+this.windowMs,price:p,removedQty:Math.min(q,visible),before:this.book,lastBook:this.book});
 }
 flush(now){
  const done=[],keep=[];
  for(const p of this.pending){
   if(now<p.dueAt){keep.push(p);continue;}
   if(p.removedQty<=0)continue;
   const before=p.side==='sell'?sumAtOrBelow(p.before.bids,p.price):sumAtOrAbove(p.before.asks,p.price);
   const after=p.side==='sell'?sumAtOrBelow(p.lastBook.bids,p.price):sumAtOrAbove(p.lastBook.asks,p.price);
   const depleted=Math.max(0,before-p.removedQty);
   const replenishedQty=Math.max(0,after-depleted);
   const lr=replenishedQty/p.removedQty;
   done.push({ts:p.dueAt,side:p.side,price:p.price,removedQty:p.removedQty,replenishedQty,lr,
    regime:lr>=0.8?'absorption':lr<=0.2?'withdrawal':'mixed'});
  }
  this.pending=keep;return done;
 }
}
