CREATE TABLE IF NOT EXISTS runs (
 source TEXT NOT NULL, tick INTEGER NOT NULL, PRIMARY KEY(source,tick)
);
CREATE TABLE IF NOT EXISTS snapshots (
 source TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(source,ts)
);
CREATE TABLE IF NOT EXISTS state (
 source TEXT PRIMARY KEY, ts INTEGER NOT NULL, cooldown TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
 source TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(source,ts)
);
CREATE TABLE IF NOT EXISTS budget (
 month TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shadow_signals (
 signal_id TEXT PRIMARY KEY,
 source TEXT NOT NULL,
 asset_id TEXT NOT NULL,
 symbol TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 direction INTEGER NOT NULL CHECK(direction IN (-1,1)),
 baseline_direction INTEGER NOT NULL CHECK(baseline_direction IN (-1,1)),
 entry_price REAL NOT NULL CHECK(entry_price > 0),
 trigger_change_pct REAL NOT NULL,
 round_trip_cost_bps REAL NOT NULL CHECK(round_trip_cost_bps >= 0),
 model_version TEXT NOT NULL,
 baseline_model_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_outcomes (
 signal_id TEXT NOT NULL REFERENCES shadow_signals(signal_id),
 horizon_minutes INTEGER NOT NULL CHECK(horizon_minutes IN (15,60,240)),
 due_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluated','missing')),
 evaluated_at INTEGER,
 missing_reason TEXT,
 exit_price REAL,
 gross_return_bps REAL,
 net_return_bps REAL,
 baseline_net_return_bps REAL,
 PRIMARY KEY(signal_id,horizon_minutes)
);

CREATE INDEX IF NOT EXISTS shadow_outcomes_due
 ON shadow_outcomes(status,due_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
 notification_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('signal','outcome','missing')),
 created_at INTEGER NOT NULL,
 payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent')),
 attempts INTEGER NOT NULL DEFAULT 0,
 last_attempt_at INTEGER,
 sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS notification_outbox_pending
 ON notification_outbox(status,created_at);

CREATE TRIGGER IF NOT EXISTS shadow_signals_no_update
 BEFORE UPDATE ON shadow_signals BEGIN
  SELECT RAISE(ABORT,'shadow_signals are immutable');
 END;

CREATE TRIGGER IF NOT EXISTS shadow_signals_no_delete
 BEFORE DELETE ON shadow_signals BEGIN
  SELECT RAISE(ABORT,'shadow_signals are immutable');
 END;

CREATE TRIGGER IF NOT EXISTS finalized_outcomes_no_update
 BEFORE UPDATE ON shadow_outcomes WHEN OLD.status<>'pending' BEGIN
  SELECT RAISE(ABORT,'finalized shadow_outcome is immutable');
END;

CREATE TRIGGER IF NOT EXISTS notification_payload_no_update
 BEFORE UPDATE OF notification_id,kind,created_at,payload ON notification_outbox BEGIN
  SELECT RAISE(ABORT,'notification payload is immutable');
 END;

CREATE VIEW IF NOT EXISTS shadow_scorecard AS
SELECT s.model_version, s.baseline_model_version, o.horizon_minutes,
 SUM(CASE WHEN o.status='evaluated' THEN 1 ELSE 0 END) AS evaluated_count,
 SUM(CASE WHEN o.status='missing' THEN 1 ELSE 0 END) AS missing_count,
 SUM(CASE WHEN o.status='pending' THEN 1 ELSE 0 END) AS pending_count,
 AVG(CASE WHEN o.status='evaluated' THEN o.net_return_bps END) AS model_avg_net_bps,
 AVG(CASE WHEN o.status='evaluated' THEN o.baseline_net_return_bps END) AS baseline_avg_net_bps,
 AVG(CASE WHEN o.status='evaluated' THEN o.net_return_bps-o.baseline_net_return_bps END) AS edge_bps,
 AVG(CASE WHEN o.status='evaluated' THEN CASE WHEN o.net_return_bps>0 THEN 1.0 ELSE 0.0 END END) AS model_hit_rate,
 AVG(CASE WHEN o.status='evaluated' THEN CASE WHEN o.baseline_net_return_bps>0 THEN 1.0 ELSE 0.0 END END) AS baseline_hit_rate
FROM shadow_signals s JOIN shadow_outcomes o USING(signal_id)
GROUP BY s.model_version,s.baseline_model_version,o.horizon_minutes;
