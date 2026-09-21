const stable = value => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
};

export function canonicalClaim(claim) {
  const required=['claim_id','agent_id','model_version','source','asset_id','symbol','created_at','direction','entry_price','round_trip_cost_bps','baseline_model_version'];
  for (const key of required) if (claim[key] === undefined || claim[key] === null) throw new Error('missing_'+key);
  if (![1,-1].includes(claim.direction)) throw new Error('invalid_direction');
  if (!(Number(claim.entry_price)>0)) throw new Error('invalid_entry_price');
  return stable(Object.fromEntries(required.map(k=>[k,claim[k]])));
}

export async function claimHash(claim) {
  const bytes=new TextEncoder().encode(canonicalClaim(claim));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
