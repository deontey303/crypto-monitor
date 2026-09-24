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
 baseline_model_version TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 claim_hash TEXT NOT NULL UNIQUE
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


-- VIRA economy-of-cognition: preregistered sensor acquisition ledger.
CREATE TABLE IF NOT EXISTS decision_measurements (
 measurement_id TEXT PRIMARY KEY,
 decision_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 instrument TEXT NOT NULL,
 horizon TEXT NOT NULL,
 policy TEXT NOT NULL CHECK(policy IN ('ig','always','random')),
 pre_action TEXT NOT NULL CHECK(pre_action IN ('LONG','SHORT','WAIT','NO_TRADE')),
 hypotheses_json TEXT NOT NULL,
 sensor_id TEXT NOT NULL,
 p_action_change REAL NOT NULL CHECK(p_action_change>=0 AND p_action_change<=1),
 expected_loss_avoided REAL NOT NULL CHECK(expected_loss_avoided>=0),
 measurement_cost REAL NOT NULL CHECK(measurement_cost>=0),
 latency_cost REAL NOT NULL CHECK(latency_cost>=0),
 ignorance_bid REAL NOT NULL,
 action_map_json TEXT NOT NULL,
 entry_price REAL CHECK(entry_price>0),
 observed_at INTEGER,
 observed_value_json TEXT,
 post_action TEXT CHECK(post_action IN ('LONG','SHORT','WAIT','NO_TRADE')),
 outcome_at INTEGER,
 net_decision_value REAL,
 counterfactual_pre_action_value REAL
);
CREATE INDEX IF NOT EXISTS decision_measurements_decision ON decision_measurements(decision_id,policy);
CREATE TRIGGER IF NOT EXISTS decision_measurements_freeze_preregistered
 BEFORE UPDATE ON decision_measurements
 WHEN NEW.decision_id<>OLD.decision_id OR NEW.created_at<>OLD.created_at OR NEW.instrument<>OLD.instrument
   OR NEW.horizon<>OLD.horizon OR NEW.policy<>OLD.policy OR NEW.pre_action<>OLD.pre_action
   OR NEW.hypotheses_json<>OLD.hypotheses_json OR NEW.sensor_id<>OLD.sensor_id
   OR NEW.p_action_change<>OLD.p_action_change OR NEW.expected_loss_avoided<>OLD.expected_loss_avoided
   OR NEW.measurement_cost<>OLD.measurement_cost OR NEW.latency_cost<>OLD.latency_cost
   OR NEW.ignorance_bid<>OLD.ignorance_bid OR NEW.action_map_json<>OLD.action_map_json
 BEGIN SELECT RAISE(ABORT,'preregistered measurement fields are immutable'); END;


CREATE TABLE IF NOT EXISTS ignorance_states (
 decision_id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 instrument TEXT NOT NULL,
 horizon TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('BREAKOUT','SPOT_PERP_CAUSE','JUMP','PRICE_DISCOVERY','QUIET')),
 feature_schema_version TEXT NOT NULL,
 pre_flow_features_json TEXT NOT NULL,
 flow_observed_at INTEGER,
 CHECK(flow_observed_at IS NULL OR flow_observed_at>=created_at)
);
CREATE TRIGGER IF NOT EXISTS ignorance_states_no_update
 BEFORE UPDATE ON ignorance_states BEGIN
  SELECT RAISE(ABORT,'ignorance state is immutable; append FLOW to decision_measurements instead');
 END;
CREATE TRIGGER IF NOT EXISTS ignorance_states_no_delete
 BEFORE DELETE ON ignorance_states BEGIN SELECT RAISE(ABORT,'ignorance state is immutable'); END;

-- D1 migration note: entry_price is added in deployment migration; fresh schema includes it below.
CREATE TABLE IF NOT EXISTS cognition_outcomes(decision_id TEXT NOT NULL,horizon_minutes INTEGER NOT NULL CHECK(horizon_minutes IN (60,240)),due_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluated','missing')),evaluated_at INTEGER,PRIMARY KEY(decision_id,horizon_minutes));
CREATE INDEX IF NOT EXISTS cognition_outcomes_due ON cognition_outcomes(status,due_at);
CREATE TABLE IF NOT EXISTS cognition_policy_outcomes(decision_id TEXT NOT NULL,horizon_minutes INTEGER NOT NULL,policy TEXT NOT NULL CHECK(policy IN ('ig','always','random')),exit_price REAL NOT NULL CHECK(exit_price>0),net_decision_value REAL NOT NULL,counterfactual_pre_action_value REAL NOT NULL,PRIMARY KEY(decision_id,horizon_minutes,policy));


-- VIRA Signal Runtime v1: append-only runtime observability / watchdog source.
CREATE TABLE IF NOT EXISTS vira_runtime_events (
 event_id TEXT PRIMARY KEY,
 created_at INTEGER NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('heartbeat','cycle_ok','cycle_error','critic_veto')),
 payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vira_runtime_events_created ON vira_runtime_events(created_at);
CREATE TRIGGER IF NOT EXISTS vira_runtime_events_no_update
 BEFORE UPDATE ON vira_runtime_events BEGIN SELECT RAISE(ABORT,'vira runtime events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS vira_runtime_events_no_delete
 BEFORE DELETE ON vira_runtime_events BEGIN SELECT RAISE(ABORT,'vira runtime events are append-only'); END;


-- PriceNet frozen prospective shadow ledger.
CREATE TABLE IF NOT EXISTS pricenet_predictions (
 prediction_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, observed_bar_at INTEGER NOT NULL,
 due_at INTEGER NOT NULL, entry_price REAL NOT NULL CHECK(entry_price>0), source TEXT NOT NULL,
 model_version TEXT NOT NULL, training_run_id TEXT NOT NULL, feature_json TEXT NOT NULL,
 p_up REAL NOT NULL, p_down REAL NOT NULL, p_range REAL NOT NULL, predicted_class TEXT NOT NULL CHECK(predicted_class IN ('UP','DOWN','RANGE')),
 predicted_mfe_bps REAL, predicted_mae_bps REAL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluated')),
 evaluated_at INTEGER, exit_price REAL, realized_return_bps REAL, realized_class TEXT CHECK(realized_class IN ('UP','DOWN','RANGE'))
);
CREATE INDEX IF NOT EXISTS pricenet_due ON pricenet_predictions(status,due_at);
CREATE TRIGGER IF NOT EXISTS pricenet_preregistered_immutable BEFORE UPDATE ON pricenet_predictions
 WHEN NEW.prediction_id<>OLD.prediction_id OR NEW.created_at<>OLD.created_at OR NEW.observed_bar_at<>OLD.observed_bar_at OR NEW.due_at<>OLD.due_at OR NEW.entry_price<>OLD.entry_price OR NEW.source<>OLD.source OR NEW.model_version<>OLD.model_version OR NEW.training_run_id<>OLD.training_run_id OR NEW.feature_json<>OLD.feature_json OR NEW.p_up<>OLD.p_up OR NEW.p_down<>OLD.p_down OR NEW.p_range<>OLD.p_range OR NEW.predicted_class<>OLD.predicted_class OR NEW.predicted_mfe_bps<>OLD.predicted_mfe_bps OR NEW.predicted_mae_bps<>OLD.predicted_mae_bps
 BEGIN SELECT RAISE(ABORT,'pricenet preregistration immutable'); END;
