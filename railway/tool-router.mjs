const ACTIONS = new Set(['LONG','SHORT','WAIT','NO_TRADE']);
export function routeMeasurement(input) {
 const {decision_id,residual,pre_action='WAIT',competing_models=[],candidate_measurements=[],min_ignorance_bid=0}=input??{};
 if(!decision_id||!residual) throw new Error('decision_id_and_residual_required');
 if(!ACTIONS.has(pre_action)) throw new Error('invalid_pre_action');
 const candidates=candidate_measurements.map((m,i)=>{const p=Number(m.p_action_change??0),avoided=Number(m.expected_loss_avoided??0),cost=Number(m.measurement_cost??0),latency=Number(m.latency_cost??0);return {...m,candidate_index:i,ignorance_bid:p*avoided-cost-latency};}).sort((a,b)=>b.ignorance_bid-a.ignorance_bid);
 const best=candidates[0]??null;
 if(!best)return {decision_id,residual,pre_action,competing_models,route:'SENSOR_GENESIS',reason:'no_candidate_measurement',selected:null};
 if(best.ignorance_bid<=min_ignorance_bid)return {decision_id,residual,pre_action,competing_models,route:'NO_TOOL_CALL',reason:'measurement_cannot_justify_cost',selected:best};
 if(best.available===false)return {decision_id,residual,pre_action,competing_models,route:'SENSOR_GENESIS',reason:'best_discriminative_measurement_unavailable',selected:best};
 return {decision_id,residual,pre_action,competing_models,route:'MEASURE',reason:'positive_ignorance_bid',selected:best};
}
export function preregistrationRow(route,now=Date.now()){
 if(route.route!=='MEASURE')return null; const m=route.selected;
 return {measurement_id:m.measurement_id??`${route.decision_id}:${m.sensor_id}`,decision_id:route.decision_id,created_at:now,instrument:m.instrument??'UNKNOWN',horizon:m.horizon??'UNKNOWN',policy:m.policy??'ig',pre_action:route.pre_action,hypotheses_json:JSON.stringify(route.competing_models??[]),sensor_id:m.sensor_id,p_action_change:Number(m.p_action_change??0),expected_loss_avoided:Number(m.expected_loss_avoided??0),measurement_cost:Number(m.measurement_cost??0),latency_cost:Number(m.latency_cost??0),ignorance_bid:Number(m.ignorance_bid),action_map_json:JSON.stringify(m.action_map??{})};
}
