# Crypto Monitor — initial price collector

Python 3.11+; no third-party dependencies. Run from repository root:

```sh
python -m unittest discover -s tests
python monitor.py
```

## Implemented
- CMC top 300 by market cap every 15 minutes, only when CMC_API_KEY is configured.
- DexScreener watchlist every 60 seconds. Requires a base-token match and $10K pool liquidity.
- SQLite snapshots retained 7 days; local signal history retained 30 days.
- Signals: absolute price change >=10% against a snapshot 5–30 minutes ago, with 30-minute cooldown.
- GET /health exposes collector timestamps, never secrets or portfolio information.
- Timeouts, bounded polling, SIGTERM shutdown and sanitized error logs.

## Render configuration (not deployed)
Repository: https://github.com/deontey303/crypto-monitor
Branch: main; runtime: Python; region: Frankfurt.
Build command: python -m unittest discover -s tests
Start command: python monitor.py
Health path: /health
CMC_API_KEY: enter a replacement key in Render Environment; never commit it.
PORT: assigned by Render. DB_PATH: monitor.sqlite3 by default.

Always-on hosting requires a paid service. Approve the compute and storage cost first.
SQLite on Render's default filesystem is temporary and disappears on restarts/deploys.
For durable history, attach a persistent disk and set DB_PATH to its mount path,
or implement a PostgreSQL adapter. No Supabase resources are created by this project.
Run a single instance; this version does not coordinate concurrent collectors.

## Limitations
No X access, Telegram delivery, AI interpretation, contract safety audit, or trading.
CMC is disabled until a key is configured. Provider endpoint access and credits must be
verified against the actual account; 15-minute polling is not a guarantee of quota fit.
CMC 15-minute sampling can miss intrainterval moves; signals use a 5–30 minute baseline.
DexScreener latest profiles is NOT an exhaustive new-token feed. This version only
monitors watchlist.json. Missing/illiquid pairs are skipped; quote-only pairs are skipped
to avoid recording the other asset's price. A successful API check is not proof of fresh trades.
No remote collector calls have been validated by local unit tests.
