import crypto from 'node:crypto';
export const canonicalStringify=x=>JSON.stringify(x,Object.keys(x).sort());
export const eventHash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function canonicalEvent({venue,marketType,symbol,eventType,exchangeEventTime,ingestTime=Date.now(),sequenceId=null,payload,sourceEndpoint,collectorVersion='market-observatory-ingest-v1',previousHash=null}){
 const body={schema_version:'canonical-market-event-v1',venue,market_type:marketType,symbol,event_type:eventType,exchange_event_time:exchangeEventTime,ingest_time:ingestTime,sequence_id:sequenceId,payload,source_endpoint:sourceEndpoint,collector_version:collectorVersion,previous_hash:previousHash};
 return {...body,event_hash:eventHash(body)};
}
export function verifyCanonicalEvent(e){const {event_hash,...body}=e;return eventHash(body)===event_hash}
