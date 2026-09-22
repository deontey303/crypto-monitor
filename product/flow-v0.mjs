import {chooseMeasurement} from './ignorance-gradient.mjs';

const BPS=10000;
export function flowMeasurement({spotBuy,spotSell,perpBuy,perpSell}){
  const sb=Number(spotBuy),ss=Number(spotSell),pb=Number(perpBuy),ps=Number(perpSell);
  if([sb,ss,pb,ps].some(x=>!Number.isFinite(x)||x<0)) throw new Error('invalid_flow');
  const spotTotal=sb+ss,perpTotal=pb+ps;
  const spot=spotTotal? (sb-ss)/spotTotal:0;
  const perp=perpTotal? (pb-ps)/perpTotal:0;
  return {spotImbalance:spot,perpImbalance:perp,flowScore:(spot+perp)/2,disagreement:Math.abs(spot-perp)};
}
export function flowAction(m){
  // Frozen v0 bins. Deliberately coarse; thresholds must be changed only in a new model version.
  if(m.flowScore>=0.20 && m.disagreement<0.35) return 'LONG';
  if(m.flowScore<=-0.20 && m.disagreement<0.35) return 'SHORT';
  return 'WAIT';
}
export function makePolicies({decisionId,ts,instrument,horizon,preAction='WAIT',hypotheses=[],sensorBid,randomUnit=0}){
  const selected=chooseMeasurement([{id:'FLOW',...sensorBid}]);
  const common={decisionId,ts,instrument,horizon,preAction,hypotheses,sensorId:'FLOW'};
  return [
    {...common,policy:'ig',acquire:selected.action==='ACQUIRE',ignoranceBid:selected.sensor?.ignoranceBid??sensorBid.pActionChange*sensorBid.expectedLossAvoided-sensorBid.measurementCost-sensorBid.latencyCost},
    {...common,policy:'always',acquire:true,ignoranceBid:null},
    {...common,policy:'random',acquire:randomUnit<Math.max(0,Math.min(1,sensorBid.randomAcquisitionRate??0.5)),ignoranceBid:null}
  ];
}
export function scoreAction(action,entry,exit,costBps=20){
  if(action==='WAIT'||action==='NO_TRADE') return 0;
  const dir=action==='LONG'?1:action==='SHORT'?-1:0;
  if(!dir||!(entry>0)||!(exit>0)) throw new Error('invalid_score');
  return dir*((exit/entry-1)*BPS)-costBps;
}
