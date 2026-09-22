CREATE TABLE IF NOT EXISTS runs (source TEXT NOT NULL,tick BIGINT NOT NULL,PRIMARY KEY(source,tick));
CREATE TABLE IF NOT EXISTS snapshots (source TEXT NOT NULL,ts BIGINT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(source,ts));
CREATE TABLE IF NOT EXISTS state (source TEXT PRIMARY KEY,ts BIGINT NOT NULL,cooldown TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signals (source TEXT NOT NULL,ts BIGINT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(source,ts));
CREATE TABLE IF NOT EXISTS budget (month TEXT PRIMARY KEY,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS shadow_signals (
 signal_id TEXT PRIMARY KEY,source TEXT NOT NULL,asset_id TEXT NOT NULL,symbol TEXT NOT NULL,created_at BIGINT NOT NULL,
 direction INTEGER NOT NULL CHECK(direction IN (-1,1)),baseline_direction INTEGER NOT NULL CHECK(baseline_direction IN (-1,1)),
 entry_price DOUBLE PRECISION NOT NULL CHECK(entry_price>0),trigger_change_pct DOUBLE PRECISION NOT NULL,
 round_trip_cost_bps DOUBLE PRECISION NOT NULL CHECK(round_trip_cost_bps>=0),model_version TEXT NOT NULL,
 baseline_model_version TEXT NOT NULL,agent_id TEXT NOT NULL,claim_hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS shadow_outcomes (
 signal_id TEXT NOT NULL REFERENCES shadow_signals(signal_id),horizon_minutes INTEGER NOT NULL CHECK(horizon_minutes IN (15,60,240)),
 due_at BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluated','missing')),
 evaluated_at BIGINT,missing_reason TEXT,exit_price DOUBLE PRECISION,gross_return_bps DOUBLE PRECISION,
 net_return_bps DOUBLE PRECISION,baseline_net_return_bps DOUBLE PRECISION,PRIMARY KEY(signal_id,horizon_minutes));
CREATE INDEX IF NOT EXISTS shadow_outcomes_due ON shadow_outcomes(status,due_at);
CREATE TABLE IF NOT EXISTS notification_outbox (
 notification_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('signal','outcome','missing')),created_at BIGINT NOT NULL,
 payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent')),attempts INTEGER NOT NULL DEFAULT 0,
 last_attempt_at BIGINT,sent_at BIGINT);
CREATE INDEX IF NOT EXISTS notification_outbox_pending ON notification_outbox(status,created_at);
CREATE OR REPLACE FUNCTION deny_shadow_signal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'shadow_signals are immutable'; END $$;
DROP TRIGGER IF EXISTS shadow_signals_no_update ON shadow_signals;
CREATE TRIGGER shadow_signals_no_update BEFORE UPDATE OR DELETE ON shadow_signals FOR EACH ROW EXECUTE FUNCTION deny_shadow_signal_mutation();
CREATE OR REPLACE FUNCTION deny_finalized_outcome_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status<>'pending' THEN RAISE EXCEPTION 'finalized shadow_outcome is immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS finalized_outcomes_no_update ON shadow_outcomes;
CREATE TRIGGER finalized_outcomes_no_update BEFORE UPDATE ON shadow_outcomes FOR EACH ROW EXECUTE FUNCTION deny_finalized_outcome_update();
CREATE OR REPLACE FUNCTION protect_notification_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notification_id IS DISTINCT FROM OLD.notification_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.payload IS DISTINCT FROM OLD.payload THEN RAISE EXCEPTION 'notification payload is immutable'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS notification_payload_no_update ON notification_outbox;
CREATE TRIGGER notification_payload_no_update BEFORE UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION protect_notification_payload();
CREATE OR REPLACE VIEW shadow_scorecard AS SELECT s.model_version,s.baseline_model_version,o.horizon_minutes,
 COUNT(*) FILTER (WHERE o.status='evaluated') AS evaluated_count,COUNT(*) FILTER (WHERE o.status='missing') AS missing_count,
 COUNT(*) FILTER (WHERE o.status='pending') AS pending_count,AVG(o.net_return_bps) FILTER (WHERE o.status='evaluated') AS model_avg_net_bps,
 AVG(o.baseline_net_return_bps) FILTER (WHERE o.status='evaluated') AS baseline_avg_net_bps,
 AVG(o.net_return_bps-o.baseline_net_return_bps) FILTER (WHERE o.status='evaluated') AS edge_bps,
 AVG(CASE WHEN o.net_return_bps>0 THEN 1.0 ELSE 0.0 END) FILTER (WHERE o.status='evaluated') AS model_hit_rate,
 AVG(CASE WHEN o.baseline_net_return_bps>0 THEN 1.0 ELSE 0.0 END) FILTER (WHERE o.status='evaluated') AS baseline_hit_rate
 FROM shadow_signals s JOIN shadow_outcomes o USING(signal_id) GROUP BY s.model_version,s.baseline_model_version,o.horizon_minutes;


-- VIRA economy-of-cognition: preregistered sensor acquisition ledger.
CREATE TABLE IF NOT EXISTS decision_measurements (
 measurement_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, created_at BIGINT NOT NULL,
 instrument TEXT NOT NULL, horizon TEXT NOT NULL, policy TEXT NOT NULL CHECK(policy IN ('ig','always','random')),
 pre_action TEXT NOT NULL CHECK(pre_action IN ('LONG','SHORT','WAIT','NO_TRADE')),
 hypotheses_json TEXT NOT NULL, sensor_id TEXT NOT NULL,
 p_action_change DOUBLE PRECISION NOT NULL CHECK(p_action_change>=0 AND p_action_change<=1),
 expected_loss_avoided DOUBLE PRECISION NOT NULL CHECK(expected_loss_avoided>=0),
 measurement_cost DOUBLE PRECISION NOT NULL CHECK(measurement_cost>=0),
 latency_cost DOUBLE PRECISION NOT NULL CHECK(latency_cost>=0), ignorance_bid DOUBLE PRECISION NOT NULL,
 action_map_json TEXT NOT NULL, observed_at BIGINT, observed_value_json TEXT,
 post_action TEXT CHECK(post_action IN ('LONG','SHORT','WAIT','NO_TRADE')),
 outcome_at BIGINT, net_decision_value DOUBLE PRECISION, counterfactual_pre_action_value DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS decision_measurements_decision ON decision_measurements(decision_id,policy);
CREATE OR REPLACE FUNCTION protect_measurement_preregistration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.decision_id IS DISTINCT FROM OLD.decision_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.instrument IS DISTINCT FROM OLD.instrument OR NEW.horizon IS DISTINCT FROM OLD.horizon
 OR NEW.policy IS DISTINCT FROM OLD.policy OR NEW.pre_action IS DISTINCT FROM OLD.pre_action
 OR NEW.hypotheses_json IS DISTINCT FROM OLD.hypotheses_json OR NEW.sensor_id IS DISTINCT FROM OLD.sensor_id
 OR NEW.p_action_change IS DISTINCT FROM OLD.p_action_change OR NEW.expected_loss_avoided IS DISTINCT FROM OLD.expected_loss_avoided
 OR NEW.measurement_cost IS DISTINCT FROM OLD.measurement_cost OR NEW.latency_cost IS DISTINCT FROM OLD.latency_cost
 OR NEW.ignorance_bid IS DISTINCT FROM OLD.ignorance_bid OR NEW.action_map_json IS DISTINCT FROM OLD.action_map_json
 THEN RAISE EXCEPTION 'preregistered measurement fields are immutable'; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS decision_measurements_freeze_preregistered ON decision_measurements;
CREATE TRIGGER decision_measurements_freeze_preregistered BEFORE UPDATE ON decision_measurements
 FOR EACH ROW EXECUTE FUNCTION protect_measurement_preregistration();


CREATE TABLE IF NOT EXISTS ignorance_states (
 decision_id TEXT PRIMARY KEY,created_at BIGINT NOT NULL,instrument TEXT NOT NULL,horizon TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('BREAKOUT','SPOT_PERP_CAUSE','JUMP','PRICE_DISCOVERY','QUIET')),
 feature_schema_version TEXT NOT NULL,pre_flow_features_json TEXT NOT NULL,flow_observed_at BIGINT,
 CHECK(flow_observed_at IS NULL OR flow_observed_at>=created_at)
);
CREATE OR REPLACE FUNCTION deny_ignorance_state_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ignorance state is immutable'; END $$;
DROP TRIGGER IF EXISTS ignorance_states_no_update ON ignorance_states;
CREATE TRIGGER ignorance_states_no_update BEFORE UPDATE OR DELETE ON ignorance_states FOR EACH ROW EXECUTE FUNCTION deny_ignorance_state_mutation();

ALTER TABLE decision_measurements ADD COLUMN IF NOT EXISTS entry_price DOUBLE PRECISION CHECK(entry_price>0);
CREATE TABLE IF NOT EXISTS cognition_outcomes(
 decision_id TEXT NOT NULL REFERENCES ignorance_states(decision_id),horizon_minutes INTEGER NOT NULL CHECK(horizon_minutes IN (60,240)),
 due_at BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluated','missing')),evaluated_at BIGINT,
 PRIMARY KEY(decision_id,horizon_minutes));
CREATE INDEX IF NOT EXISTS cognition_outcomes_due ON cognition_outcomes(status,due_at);
CREATE TABLE IF NOT EXISTS cognition_policy_outcomes(
 decision_id TEXT NOT NULL,horizon_minutes INTEGER NOT NULL,policy TEXT NOT NULL CHECK(policy IN ('ig','always','random')),
 exit_price DOUBLE PRECISION NOT NULL CHECK(exit_price>0),net_decision_value DOUBLE PRECISION NOT NULL,
 counterfactual_pre_action_value DOUBLE PRECISION NOT NULL,
 PRIMARY KEY(decision_id,horizon_minutes,policy));
