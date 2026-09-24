import crypto from 'node:crypto';

export function canonicalStringify(x){
 if(x===null)return 'null';
 if(typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
 if(typeof x==='number'){if(!Number.isFinite(x))throw new TypeError('non_finite_number');return JSON.stringify(x)}
 if(Array.isArray(x))return '['+x.map(canonicalStringify).join(',')+']';
 if(typeof x==='object')return '{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalStringify(x[k])).join(',')+'}';
 throw new TypeError('unsupported_canonical_type');
}
export const eventHash=x=>crypto.createHash('sha256').update(canonicalStringify(x)).digest('hex');
export function canonicalEvent({venue,marketType,symbol,eventType,exchangeEventTime,ingestTime=Date.now(),sequenceId=null,payload,sourceEndpoint,collectorVersion='market-observatory-ingest-v1',previousHash=null}){
 const body={schema_version:'canonical-market-event-v1',venue,market_type:marketType,symbol,event_type:eventType,exchange_event_time:exchangeEventTime,ingest_time:ingestTime,sequence_id:sequenceId,payload,source_endpoint:sourceEndpoint,collector_version:collectorVersion,previous_hash:previousHash};
 return {...body,event_hash:eventHash(body)};
}
export function verifyCanonicalEvent(e){if(!e||typeof e!=='object'||typeof e.event_hash!=='string')return false;const {event_hash,...body}=e;return eventHash(body)===event_hash}
