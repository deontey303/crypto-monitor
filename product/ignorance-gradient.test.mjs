import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ignoranceBid,chooseMeasurement,actionAfterMeasurement,freezeAcquisition} from './ignorance-gradient.mjs';

test('ignorance bid prices decision-sensitive uncertainty net of cognition costs',()=>{
  assert.equal(ignoranceBid({pActionChange:.5,expectedLossAvoided:100,measurementCost:10,latencyCost:5}),35);
});
test('buys only the highest positive unknown and abstains when information is not worth its cost',()=>{
  const pick=chooseMeasurement([
    {id:'rsi',pActionChange:.01,expectedLossAvoided:20,measurementCost:1,latencyCost:0},
    {id:'flow',pActionChange:.4,expectedLossAvoided:100,measurementCost:4,latencyCost:1}
  ]);
  assert.equal(pick.action,'ACQUIRE'); assert.equal(pick.sensor.id,'flow');
  assert.equal(chooseMeasurement([{id:'x',pActionChange:.1,expectedLossAvoided:1,measurementCost:2,latencyCost:0}]).action,'NO_ACQUIRE');
});
test('measurement value cannot affect sensor selection; it only enters a frozen action map afterwards',()=>{
  const frozen=freezeAcquisition({decisionId:'d1',ts:1,instrument:'BTCUSDT',horizon:'1h',preAction:'WAIT',
    hypotheses:['spot-demand','leveraged-rally'],
    sensors:[{id:'flow',pActionChange:.5,expectedLossAvoided:50,measurementCost:2,latencyCost:1,observedValue:999}]});
  assert.equal(frozen.selectedSensor,'flow');
  const map=[{lt:-.2,action:'SHORT'},{lt:.2,action:'WAIT',elseAction:'LONG'}];
  assert.equal(actionAfterMeasurement(map,-.3),'SHORT');
  assert.equal(actionAfterMeasurement(map,0),'WAIT');
  assert.equal(actionAfterMeasurement(map,.3),'LONG');
});
