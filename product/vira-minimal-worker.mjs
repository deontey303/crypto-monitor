import pg from 'pg';
import crypto from 'node:crypto';

const {Pool}=pg;
const SYMBOL='BTCUSDT', INTERVAL_MS=5*60*1000, HORIZONS=[15,60,240];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function price(){
  const r=await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',{signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error('market_'+r.status);
  const p=Number((await r.json()).price); if(!(p>0)) throw new Error('bad_price'); return p;
}
function decide(prev,p){
  if(!prev) return {action:'NO_TRADE',evidence:{reason:'bootstrap',price:p}};
  const changeBps=(p/prev-1)*10000;
  const action=changeBps>=25?'LONG':changeBps<=-25?'SHORT':'NO_TRADE';
  return {action,evidence:{rule:'5m_momentum_25bps_v0',previous_price:prev,current_price:p,change_bps:Math.round(changeBps*100)/100}};
}
async function schema(db){await db.query(`CREATE TABLE IF NOT EXISTS vira_minimal_decisions(
 decision_id text PRIMARY KEY, created_at timestamptz NOT NULL, instrument text NOT NULL,
 evidence jsonb NOT NULL, action text NOT NULL CHECK(action IN ('LONG','SHORT','NO_TRADE')),
 entry_price double precision NOT NULL CHECK(entry_price>0));
 CREATE TABLE IF NOT EXISTS vira_minimal_outcomes(
 decision_id text REFERENCES vira_minimal_decisions(decision_id), horizon_minutes int NOT NULL,
 due_at timestamptz NOT NULL, evaluated_at timestamptz, exit_price double precision,
 net_return_bps double precision, PRIMARY KEY(decision_id,horizon_minutes));
 CREATE OR REPLACE FUNCTION vira_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'decision immutable'; END $$;
 DROP TRIGGER IF EXISTS vira_minimal_decisions_no_update ON vira_minimal_decisions;
 CREATE TRIGGER vira_minimal_decisions_no_update BEFORE UPDATE OR DELETE ON vira_minimal_decisions FOR EACH ROW EXECUTE FUNCTION vira_decision_immutable();`)}
async function settle(db,now,p){
 const {rows}=await db.query(`SELECT o.decision_id,o.horizon_minutes,d.action,d.entry_price FROM vira_minimal_outcomes o JOIN vira_minimal_decisions d USING(decision_id) WHERE o.evaluated_at IS NULL AND o.due_at<=$1`,[now]);
 for(const x of rows){const dir=x.action==='LONG'?1:x.action==='SHORT'?-1:0;const net=dir*(p/x.entry_price-1)*10000;
  await db.query('UPDATE vira_minimal_outcomes SET evaluated_at=$1,exit_price=$2,net_return_bps=$3 WHERE decision_id=$4 AND horizon_minutes=$5 AND evaluated_at IS NULL',[now,p,net,x.decision_id,x.horizon_minutes]);}
 return rows.length;
}
async function main(){
 const db=new Pool({connectionString:process.env.DATABASE_URL}); await schema(db);
 let prev=null; console.log(JSON.stringify({vira:'minimal-v0',status:'started'}));
 for(;;){const started=Date.now();
  try{const p=await price(), now=new Date(); const d=decide(prev,p); const id='vira-'+crypto.randomUUID();
   await db.query('BEGIN');
   try{await db.query('INSERT INTO vira_minimal_decisions VALUES($1,$2,$3,$4,$5,$6)',[id,now,SYMBOL,d.evidence,d.action,p]);
    for(const h of HORIZONS)await db.query('INSERT INTO vira_minimal_outcomes(decision_id,horizon_minutes,due_at) VALUES($1,$2,$3)',[id,h,new Date(+now+h*60000)]);
    await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e}
   const settled=await settle(db,now,p); prev=p;
   console.log(JSON.stringify({decision_id:id,created_at:now.toISOString(),instrument:SYMBOL,evidence:d.evidence,action:d.action,entry_price:p,settled}));
  }catch(e){console.error(JSON.stringify({vira:'minimal-v0',status:'error',reason:String(e.message||e)}))}
  await sleep(Math.max(1000,INTERVAL_MS-(Date.now()-started)));
 }}
main().catch(e=>{console.error(e);process.exit(1)});
