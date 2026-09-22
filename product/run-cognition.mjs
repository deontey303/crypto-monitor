import {createDB} from '../railway/db.mjs';
import {runCycle} from './cognition-cycle.mjs';

const db=createDB();
const startedAt=Date.now();
const runId='cognition:'+startedAt+':'+(process.env.RAILWAY_DEPLOYMENT_ID??'local');
const emit=async(type,payload={},extra={})=>{
  const eventId=runId+':'+type+':'+Date.now()+':'+Math.random().toString(36).slice(2,8);
  await db.prepare(`INSERT INTO cognition_runtime_events
    (event_id,run_id,created_at,event_type,decision_id,instrument,horizon_minutes,payload_json)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(eventId,runId,Date.now(),type,extra.decisionId??null,extra.instrument??null,extra.horizonMinutes??null,JSON.stringify(payload)).run();
  console.log(JSON.stringify({vira_event:type,runId,eventId,...extra,...payload}));
};
try{
  await emit('heartbeat_start',{deploymentId:process.env.RAILWAY_DEPLOYMENT_ID??null});
  const opened=await runCycle({db,onSettlement:async s=>emit('settlement',{evaluatedAt:s.evaluatedAt,exitPrice:s.exitPrice,policies:s.policies},{decisionId:s.decisionId,horizonMinutes:s.horizonMinutes})});
  for(const d of opened) await emit('decision_opened',{state:d.state,policies:d.policies,flowAcquired:d.flowAcquired},{decisionId:d.decisionId,instrument:d.decisionId.split(':')[1]});
  await emit('heartbeat_end',{ok:true,opened:opened.length});
}catch(error){
  const payload={name:error?.name??'Error',message:String(error?.message??error),stack:String(error?.stack??'').slice(0,4000)};
  try{await emit('error',payload);}catch(logError){console.error(JSON.stringify({vira_event:'error_log_failed',runId,error:payload,logError:String(logError?.message??logError)}));}
  console.error(JSON.stringify({vira_event:'run_failed',runId,...payload}));
  process.exitCode=1;
}finally{await db.close();}
