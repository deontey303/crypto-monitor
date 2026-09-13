import unittest
from unittest.mock import patch
import monitor

class MonitorTests(unittest.TestCase):
    def test_signal_cooldown_and_asset_isolation(self):
        db = monitor.database(":memory:")
        monitor.record(db, "dex", "a", 1, now=1000)
        monitor.record(db, "dex", "a", 1.2, now=1300)
        monitor.record(db, "dex", "a", 1.4, now=1360)
        monitor.record(db, "dex", "b", 100, now=1360)
        self.assertEqual(db.execute("SELECT count(*) FROM signals").fetchone()[0], 1)
        db.close()

    def test_invalid_prices_never_stored(self):
        db = monitor.database(":memory:")
        for value in [None, "bad", "NaN", "inf", 0, -1]:
            monitor.record(db, "dex", "a", value)
        self.assertEqual(db.execute("SELECT count(*) FROM snapshots").fetchone()[0], 0)
        db.close()

    def test_quote_side_does_not_become_token_price(self):
        db = monitor.database(":memory:")
        with patch("monitor.get_json", return_value=[{"chainId": "solana", "baseToken": {"address": "other"}, "priceUsd": "200", "liquidity": {"usd": 50000}}]):
            monitor.dex(db)
        self.assertEqual(db.execute("SELECT count(*) FROM snapshots").fetchone()[0], 0)
        db.close()
