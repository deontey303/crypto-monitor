// No credentials in this file. CMC_API_KEY is a Worker secret.
import watchlist from '../watchlist.json' with { type: 'json' };
const MIN = 60000;
const positive = x => Number.isFinite(Number(x)) && Number(x) > 0;
export function selectPair(pairs, token) {
  return pairs.filter(p => p.chainId === token.chain &&
    p.baseToken?.address === token.address && p.pairAddress &&
    positive(p.priceUsd) && Number(p.liquidity?.usd) >= 10000)
    .sort((a,b) => b.liquidity.usd - a.liquidity.usd)[0];
}
export function compare(current, previous, cooldown, now) {
  const next = Object.fromEntries(Object.entries(cooldown).filter(([,t]) => now-t < 30*MIN));
  const alerts = [];
  if (previous && now-previous.ts >= 4*MIN && now-previous.ts <= 30*MIN) {
    const old = JSON.parse(previous.data);
    for (const [id, quote] of Object.entries(current)) {
      if (!positive(old[id]?.price) || !positive(quote.price) || next[id]) continue;
      const change = (quote.price / old[id].price - 1)*100;
      if (Math.abs(change) >= 10) {
        alerts.push({id, ...quote, change, since: previous.ts});
        next[id] = now;
      }
    }
  }
  return {alerts, cooldown: next};
}
async function json(url, headers = {}) {
  const response = await fetch(url, {headers, signal: AbortSignal.timeout(20000), redirect:'error'});
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return response.json();
}
async function collectDex() {
  const data = {};
  // Bound subrequests on Free; increasing beyond 10 needs a new budget review.
  if (watchlist.length > 10) throw new Error('watchlist_limit');
  for (const token of watchlist) {
    try {
      const pairs = await json(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(token.chain)}/${encodeURIComponent(token.address)}`);
      const p = selectPair(pairs, token);
      if (p) data[`${token.chain}:${token.address}:${p.pairAddress}`] = {
        symbol: token.symbol, price:Number(p.priceUsd), liquidity:Number(p.liquidity.usd),
        volume24h: p.volume?.h24 ?? null, url:p.url
      };
      else console.log(JSON.stringify({source:'dex', asset:token.symbol, status:'no_eligible_pool'}));
    } catch { console.log(JSON.stringify({source:'dex', asset:token.symbol, status:'fetch_failed'})); }
  }
  if (!Object.keys(data).length) throw new Error('no_quotes');
  return data;
}
async function collectCmc(env, now) {
  if (!env.CMC_API_KEY) throw new Error('cmc_secret_missing');
  const cap = Number(env.CMC_MONTHLY_BUDGET), reserve = Number(env.CMC_CALL_RESERVE);
  if (!Number.isInteger(cap) || cap <= 0 || !Number.isInteger(reserve) || reserve < 5) throw new Error('invalid_budget');
  const month = new Date(now).toISOString().slice(0,7);
  await env.DB.prepare('INSERT OR IGNORE INTO budget(month,used) VALUES (?,0)').bind(month).run();
  const reservation = await env.DB.prepare('UPDATE budget SET used=used+? WHERE month=? AND used+?<=?')
    .bind(reserve,month,reserve,cap).run();
  if (!reservation.meta.changes) throw new Error('cmc_budget_exhausted');
  // Failures retain the reservation: no automatic retries that could spend twice.
  const body = await json('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?start=1&limit=300&convert=USD&sort=market_cap', {'X-CMC_PRO_API_KEY':env.CMC_API_KEY});
  const credits = Number(body.status?.credit_count);
  if (Number.isInteger(credits) && credits >= 0) {
    await env.DB.prepare('UPDATE budget SET used=used+? WHERE month=?').bind(credits-reserve,month).run();
  }
  if (body.status?.error_code || !Array.isArray(body.data)) throw new Error('cmc_invalid_response');
  const data = {};
  for (const coin of body.data) {
    const q = coin.quote?.USD;
    if (positive(q?.price)) data[String(coin.id)] = {symbol:coin.symbol, price:q.price, marketCap:q.market_cap, volume24h:q.volume_24h};
  }
  if (!Object.keys(data).length) throw new Error('no_quotes');
  return data;
}
export async function run(source, env, now) {
  const tick = Math.floor(now/(5*MIN));
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO runs(source,tick) VALUES (?,?)').bind(source,tick).run();
  if (!claim.meta.changes) return;
  try {
    const data = source === 'dex' ? await collectDex() : await collectCmc(env,now);
    const previous = await env.DB.prepare('SELECT ts,data FROM snapshots WHERE source=? AND ts<? ORDER BY ts DESC LIMIT 1').bind(source,now).first();
    const state = await env.DB.prepare('SELECT cooldown FROM state WHERE source=?').bind(source).first();
    const result = compare(data,previous,JSON.parse(state?.cooldown ?? '{}'),now);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO snapshots VALUES (?,?,?)').bind(source,now,JSON.stringify(data)),
      env.DB.prepare('INSERT OR REPLACE INTO state VALUES (?,?,?)').bind(source,now,JSON.stringify(result.cooldown)),
      env.DB.prepare('INSERT INTO signals VALUES (?,?,?)').bind(source,now,JSON.stringify(result.alerts)),
      env.DB.prepare('DELETE FROM snapshots WHERE source=? AND ts<?').bind(source,now-7*86400000),
      env.DB.prepare('DELETE FROM signals WHERE source=? AND ts<?').bind(source,now-30*86400000),
      env.DB.prepare('DELETE FROM runs WHERE source=? AND tick<?').bind(source,tick-288)
    ]);
    console.log(JSON.stringify({source,status:'ok',quotes:Object.keys(data).length,signals:result.alerts.length}));
  } catch (error) {
    // Never log provider bodies, headers, env or secret values.
    console.log(JSON.stringify({source,status:'failed',reason: /^[a-z_]+$/.test(error.message) ? error.message : 'request_or_storage_error'}));
    throw new Error(`${source}_collection_failed`);
  }
}
export default {
  async scheduled(event, env) {
    // Separate invocations keep CPU work independent for the two providers.
    await run(event.cron === '*/5 * * * *' ? 'dex' : 'cmc',env,event.scheduledTime);
  },
  async fetch() { return new Response('Scheduled collector; HTTP access disabled.', {status:404}); }
};
