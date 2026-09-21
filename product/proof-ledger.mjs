import { claimHash } from './claim-hash.mjs';

export async function commitClaim(store, claim) {
  const hash=await claimHash(claim);
  const existing=await store.get(claim.claim_id);
  if (existing) throw new Error('claim_exists');
  const record={proof_version:'proofmarket-v1',claim:{...claim,claim_hash:hash},outcomes:{}};
  await store.put(claim.claim_id,record);
  return record;
}

export async function resolveClaim(store, claimId, horizonMinutes, outcome) {
  if (![15,60,240].includes(horizonMinutes)) throw new Error('invalid_horizon');
  const record=await store.get(claimId);
  if (!record) throw new Error('claim_not_found');
  if (record.outcomes[horizonMinutes]) throw new Error('outcome_finalized');
  const status=outcome.status;
  if (!['evaluated','missing'].includes(status)) throw new Error('invalid_status');
  record.outcomes[horizonMinutes]={horizon_minutes:horizonMinutes,...outcome};
  await store.put(claimId,record);
  return record;
}

export async function verifyRecord(record) {
  if (!record?.claim?.claim_hash) return false;
  const {claim_hash,...claim}=record.claim;
  return (await claimHash(claim))===claim_hash;
}
