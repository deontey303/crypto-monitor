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
const HORIZONS = [15,60,240];
const rounded = value => Math.round(value*1e8)/1e8;
function shadowCost(env) {
  const value = Number(env.SHADOW_ROUND_TRIP_COST_BPS ?? 20);
  if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error('invalid_shadow_cost');
  return value;
}
async function pendingOutcomes(env,source,now) {
  const result = await env.DB.prepare(`SELECT o.signal_id,o.horizon_minutes,o.due_at,s.asset_id,s.symbol,s.direction,
    s.baseline_direction,s.entry_price,s.round_trip_cost_bps,s.model_version,s.baseline_model_version
    FROM shadow_outcomes o JOIN shadow_signals s USING(signal_id)
    WHERE s.source=? AND o.status='pending' AND o.due_at<=?`)
    .bind(source,now).all();
  return result.results ?? [];
}
const signed = value => `${value>=0?'+':''}${value.toFixed(2)}`;
function signalMessage(signalId,source,alert,direction,cost) {
  return [`🧪 SHADOW SIGNAL`,`${alert.symbol ?? alert.id} · ${direction===1?'LONG':'SHORT'}`,
    `Source: ${source}`,`Entry: ${alert.price}`,`Trigger: ${signed(alert.change)}%`,
    `Model: momentum-v1 vs contrarian-v1`,`Horizons: 15m / 1h / 4h`,`Round-trip cost: ${cost} bps`,
    `ID: ${signalId}`].join('\n');
}
function outcomeMessage(outcome,exitPrice,net,baseline) {
  return [`📊 SHADOW RESULT · ${outcome.horizon_minutes}m`,
    `${outcome.symbol} · ${outcome.direction===1?'LONG':'SHORT'}`,
    `Entry: ${outcome.entry_price} → Exit: ${exitPrice}`,
    `${outcome.model_version}: ${signed(net/100)}%`,
    `${outcome.baseline_model_version}: ${signed(baseline/100)}%`,
    `ID: ${outcome.signal_id}`].join('\n');
}
function shadowStatements(env,source,alerts,now,cost,pending,current) {
  const statements=[];
  for (const alert of alerts) {
    const signalId=`${source}:${encodeURIComponent(alert.id)}:${now}`;
    const direction=alert.change>0 ? 1 : -1;
    statements.push(env.DB.prepare(`INSERT INTO shadow_signals
      (signal_id,source,asset_id,symbol,created_at,direction,baseline_direction,entry_price,
       trigger_change_pct,round_trip_cost_bps,model_version,baseline_model_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(signalId,source,alert.id,alert.symbol ?? alert.id,now,
        direction,-direction,alert.price,rounded(alert.change),cost,'momentum-v1','contrarian-v1'));
    statements.push(env.DB.prepare(`INSERT INTO notification_outbox
      (notification_id,kind,created_at,payload) VALUES (?,?,?,?)`)
      .bind(`signal:${signalId}`,'signal',now,signalMessage(signalId,source,alert,direction,cost)));
    for (const horizon of HORIZONS) statements.push(env.DB.prepare(`INSERT INTO shadow_outcomes
      (signal_id,horizon_minutes,due_at,status) VALUES (?,?,?,'pending')`)
      .bind(signalId,horizon,now+horizon*MIN));
  }
  for (const outcome of pending) {
    const exitPrice=Number(current[outcome.asset_id]?.price);
    if (!positive(exitPrice)) {
      if (now >= outcome.due_at+30*MIN) statements.push(env.DB.prepare(`UPDATE shadow_outcomes
        SET status='missing',evaluated_at=?,missing_reason='quote_unavailable'
        WHERE signal_id=? AND horizon_minutes=? AND status='pending'`)
        .bind(now,outcome.signal_id,outcome.horizon_minutes));
      if (now >= outcome.due_at+30*MIN) statements.push(env.DB.prepare(`INSERT INTO notification_outbox
        (notification_id,kind,created_at,payload) VALUES (?,?,?,?)`)
        .bind(`missing:${outcome.signal_id}:${outcome.horizon_minutes}`,'missing',now,
          `⚠️ SHADOW RESULT · ${outcome.horizon_minutes}m\n${outcome.symbol}: quote unavailable\nID: ${outcome.signal_id}`));
      continue;
    }
    const raw=(exitPrice/outcome.entry_price-1)*10000;
    const gross=outcome.direction*raw;
    const net=rounded(gross-outcome.round_trip_cost_bps);
    const baseline=rounded(outcome.baseline_direction*raw-outcome.round_trip_cost_bps);
    statements.push(env.DB.prepare(`UPDATE shadow_outcomes SET status='evaluated',evaluated_at=?,
      exit_price=?,gross_return_bps=?,net_return_bps=?,baseline_net_return_bps=?
      WHERE signal_id=? AND horizon_minutes=? AND status='pending'`).bind(now,exitPrice,
        rounded(gross),net,baseline,
        outcome.signal_id,outcome.horizon_minutes));
    statements.push(env.DB.prepare(`INSERT INTO notification_outbox
      (notification_id,kind,created_at,payload) VALUES (?,?,?,?)`)
      .bind(`outcome:${outcome.signal_id}:${outcome.horizon_minutes}`,'outcome',now,
        outcomeMessage(outcome,exitPrice,net,baseline)));
  }
  return statements;
}
async function deliverNotifications(env,now) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    const pending = await env.DB.prepare(`SELECT notification_id,payload FROM notification_outbox
      WHERE status='pending' ORDER BY created_at LIMIT 20`).all();
    for (const item of pending.results ?? []) {
      let sent=false;
      try {
        const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:item.payload}),
          signal:AbortSignal.timeout(10000),redirect:'error'
        });
        sent=response.ok && (await response.json()).ok===true;
      } catch {}
      if (sent) await env.DB.prepare(`UPDATE notification_outbox SET status='sent',attempts=attempts+1,
        last_attempt_at=?,sent_at=? WHERE notification_id=? AND status='pending'`)
        .bind(now,now,item.notification_id).run();
      else await env.DB.prepare(`UPDATE notification_outbox SET attempts=attempts+1,last_attempt_at=?
        WHERE notification_id=? AND status='pending'`).bind(now,item.notification_id).run();
    }
  } catch { console.log(JSON.stringify({source:'telegram',status:'delivery_failed'})); }
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
    const pending = await pendingOutcomes(env,source,now);
    const cost = shadowCost(env);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO snapshots VALUES (?,?,?)').bind(source,now,JSON.stringify(data)),
      env.DB.prepare('INSERT OR REPLACE INTO state VALUES (?,?,?)').bind(source,now,JSON.stringify(result.cooldown)),
      env.DB.prepare('INSERT INTO signals VALUES (?,?,?)').bind(source,now,JSON.stringify(result.alerts)),
      env.DB.prepare('DELETE FROM snapshots WHERE source=? AND ts<?').bind(source,now-7*86400000),
      env.DB.prepare('DELETE FROM signals WHERE source=? AND ts<?').bind(source,now-30*86400000),
      env.DB.prepare('DELETE FROM runs WHERE source=? AND tick<?').bind(source,tick-288),
      ...shadowStatements(env,source,result.alerts,now,cost,pending,data)
    ]);
    await deliverNotifications(env,now);
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
