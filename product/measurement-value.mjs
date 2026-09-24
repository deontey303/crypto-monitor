// Measurement value kernel. No market edge is claimed here.
const finite = (x, name) => {
  const n=Number(x);
  if(!Number.isFinite(n)) throw new Error(`invalid_${name}`);
  return n;
};
export function ignoranceBid(sensor){
  const p=finite(sensor.pActionChange,'p_action_change');
  if(p<0||p>1) throw new Error('invalid_p_action_change');
  const avoided=Math.max(0,finite(sensor.expectedLossAvoided,'expected_loss_avoided'));
  const measurement=Math.max(0,finite(sensor.measurementCost??0,'measurement_cost'));
  const latency=Math.max(0,finite(sensor.latencyCost??0,'latency_cost'));
  return p*avoided-measurement-latency;
}
export function rankUnknowns(sensors){
  return sensors.map(s=>({...s,ignoranceBid:ignoranceBid(s)}))
    .sort((a,b)=>b.ignoranceBid-a.ignoranceBid || String(a.id).localeCompare(String(b.id)));
}
export function chooseMeasurement(sensors){
  const ranked=rankUnknowns(sensors);
  const winner=ranked[0]??null;
  return {action:winner&&winner.ignoranceBid>0?'ACQUIRE':'NO_ACQUIRE',sensor:winner&&winner.ignoranceBid>0?winner:null,ranked};
}
export function actionAfterMeasurement(frozenMap,value){
  // frozenMap is an ordered set of upper-exclusive bins created BEFORE value is observed.
  for(const bin of frozenMap){
    if(value < bin.lt) return bin.action;
  }
  return frozenMap.at(-1)?.elseAction ?? 'WAIT';
}
export function freezeAcquisition({decisionId,ts,instrument,horizon,preAction,hypotheses,sensors}){
  const pick=chooseMeasurement(sensors);
  return Object.freeze({
    decisionId,ts,instrument,horizon,preAction,
    hypotheses:[...hypotheses],
    selectedSensor:pick.sensor?.id??null,
    ignoranceBid:pick.sensor?.ignoranceBid??null,
    acquisitionAction:pick.action
  });
}
