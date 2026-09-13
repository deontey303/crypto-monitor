"""Price collector. Python standard library only; no trading or external messages."""
import json
import logging
import math
import os
import signal
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

STOP = threading.Event()
STATUS = {"dex": None, "cmc": None}

def get_json(url, headers=None):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "crypto-monitor/1.0", **(headers or {})})
    with urlopen(request, timeout=20) as response:
        return json.load(response)

def database(path):
    db = sqlite3.connect(path)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS snapshots (
      source TEXT, asset TEXT, ts INTEGER, price REAL, liquidity REAL,
      PRIMARY KEY(source, asset, ts));
    CREATE TABLE IF NOT EXISTS signals (
      source TEXT, asset TEXT, ts INTEGER, change REAL, PRIMARY KEY(source, asset, ts));
    """)
    return db

def record(db, source, asset, price, liquidity=None, now=None):
    now = int(time.time()) if now is None else now
    try:
        price = float(price)
    except (TypeError, ValueError):
        return
    if not math.isfinite(price) or price <= 0:
        return
    previous = db.execute("SELECT price FROM snapshots WHERE source=? AND asset=? AND ts BETWEEN ? AND ? ORDER BY ts DESC LIMIT 1", (source, asset, now-1800, now-300)).fetchone()
    db.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?)", (source, asset, now, price, liquidity))
    if previous:
        change = (price / previous[0] - 1) * 100
        recent = db.execute("SELECT 1 FROM signals WHERE source=? AND asset=? AND ts>?", (source, asset, now-1800)).fetchone()
        if abs(change) >= 10 and not recent:
            db.execute("INSERT INTO signals VALUES (?,?,?,?)", (source, asset, now, change))
            logging.info("price_signal source=%s asset=%s change=%.2f%%", source, asset, change)
    db.commit()

def dex(db):
    with open("watchlist.json", encoding="utf-8") as file:
        watchlist = json.load(file)
    for item in watchlist:
        chain, address = item["chain"], item["address"]
        pairs = get_json(f"https://api.dexscreener.com/token-pairs/v1/{chain}/{address}")
        # DexScreener priceUsd refers to baseToken. Never attribute quote-token price to it.
        pairs = [p for p in pairs if p.get("chainId") == chain and p.get("baseToken", {}).get("address") == address and float((p.get("liquidity") or {}).get("usd") or 0) >= 10000]
        if pairs:
            pair = max(pairs, key=lambda p: float(p["liquidity"]["usd"]))
            record(db, "dex", chain+":"+address+":"+pair["pairAddress"], pair.get("priceUsd"), pair["liquidity"]["usd"])
        else:
            logging.warning("no_eligible_pair chain=%s token=%s", chain, address)

def cmc(db):
    key = os.environ.get("CMC_API_KEY")
    if not key:
        return False
    data = get_json("https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?start=1&limit=300&convert=USD&sort=market_cap", {"X-CMC_PRO_API_KEY": key})
    if data.get("status", {}).get("error_code"):
        raise ValueError("CMC returned provider error")
    for item in data["data"]:
        record(db, "cmc", str(item["id"]), item["quote"]["USD"]["price"])
    return True

def collect():
    db = database(os.environ.get("DB_PATH", "monitor.sqlite3"))
    due = {"dex": 0, "cmc": 0}
    while not STOP.is_set():
        for name, operation, interval in [("dex", dex, 60), ("cmc", cmc, 900)]:
            if time.monotonic() < due[name]:
                continue
            try:
                result = operation(db)
                if result is not False:
                    STATUS[name] = int(time.time())
            except Exception as error:
                # Never log exceptions containing request headers, credentials or response bodies.
                logging.warning("collector_failed source=%s type=%s", name, type(error).__name__)
            due[name] = time.monotonic() + interval
        db.execute("DELETE FROM snapshots WHERE ts<?", (int(time.time())-7*86400,))
        db.execute("DELETE FROM signals WHERE ts<?", (int(time.time())-30*86400,))
        db.commit()
        STOP.wait(1)
    db.close()

class Health(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        now = int(time.time())
        healthy = STATUS["dex"] is not None and now-STATUS["dex"] < 300
        if os.environ.get("CMC_API_KEY"):
            healthy = healthy and STATUS["cmc"] is not None and now-STATUS["cmc"] < 1800
        body = json.dumps({"status": "ok" if healthy else "degraded", "last_success": STATUS, "cmc_enabled": bool(os.environ.get("CMC_API_KEY"))}).encode()
        self.send_response(200 if healthy else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "10000"))), Health)
    server.timeout = 1
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    worker = threading.Thread(target=collect)
    worker.start()
    try:
        while not STOP.is_set():
            server.handle_request()
    finally:
        STOP.set()
        server.server_close()
        worker.join()
