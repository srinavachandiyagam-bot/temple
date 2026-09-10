-- ====================================================================
-- Database Schema for Nava Chandi Yagam Event Registration System
-- Compatible with PostgreSQL 12+, Supabase, Neon, Render & Railway
-- ====================================================================

-- 1. Main Registrations Table
CREATE TABLE IF NOT EXISTS registrations (
    id BIGSERIAL PRIMARY KEY,
    registration_id VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    rasi VARCHAR(100),
    natchathiram VARCHAR(100),
    gothram VARCHAR(100),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    cashfree_order_id VARCHAR(100) UNIQUE,
    amount NUMERIC(10, 2) NOT NULL DEFAULT 1000.00,
    donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    -- Soft-archive bookkeeping (auditability: rows are NEVER physically deleted).
    -- NULL = active. Historical rows created before this column exist stay active.
    -- archived_by_admin_id is intentionally NOT a foreign key so the audit
    -- snapshot survives even if the archiving admin account is later removed.
    archived_at TIMESTAMPTZ NULL,
    archived_by_admin_id BIGINT NULL,
    archived_by_username VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Registration Family Members Table (up to 4 members per registration)
CREATE TABLE IF NOT EXISTS registration_members (
    id BIGSERIAL PRIMARY KEY,
    registration_id BIGINT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    member_number SMALLINT NOT NULL CHECK (member_number BETWEEN 1 AND 4),
    name VARCHAR(255) NOT NULL,
    rasi VARCHAR(100),
    natchathiram VARCHAR(100),
    gothram VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_registrations_registration_id ON registrations (registration_id);
CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id);
CREATE INDEX IF NOT EXISTS idx_registrations_payment_status ON registrations (payment_status);
CREATE INDEX IF NOT EXISTS idx_registrations_archived_at ON registrations (archived_at);
CREATE INDEX IF NOT EXISTS idx_registrations_mobile ON registrations (mobile);
CREATE INDEX IF NOT EXISTS idx_registration_members_registration_id ON registration_members (registration_id);

-- 4. Optional trigger to automatically update updated_at on record changes
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_registrations_timestamp ON registrations;
CREATE TRIGGER trigger_update_registrations_timestamp
BEFORE UPDATE ON registrations
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- 5. Admin Users Table (Role-based: super_admin vs admin)
CREATE TABLE IF NOT EXISTS admin_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);

-- 6. App Settings Table (canonical registration fee persistence)
-- Survives Render ephemeral filesystem restarts via PostgreSQL.
-- Only registration_amount is canonical here; other settings stay in settings.json.
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Registration Audit Log (APPEND-ONLY historical evidence).
-- One ARCHIVED row is written per archived registration inside the same
-- transaction that stamps archived_at. There is intentionally NO application
-- endpoint that deletes or purges audit-log rows.
CREATE TABLE IF NOT EXISTS registration_audit_log (
    id BIGSERIAL PRIMARY KEY,
    registration_db_id BIGINT NOT NULL,
    registration_id VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL DEFAULT 'ARCHIVED',
    actor_admin_id BIGINT NULL,
    actor_username VARCHAR(100) NULL,
    reason TEXT NULL,
    snapshot_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_db_id ON registration_audit_log (registration_db_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_id ON registration_audit_log (registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_action ON registration_audit_log (action);

-- 8. Database-level append-only guard for the audit log.
-- Blocks accidental/future application SQL from running UPDATE or DELETE on
-- registration_audit_log while still allowing INSERT and SELECT. Idempotent.
-- NOTE: this guards application-level access only. A database owner with
-- infrastructure-level access can still alter schema/drop the guard, which is
-- outside application authorization.
CREATE OR REPLACE FUNCTION prevent_registration_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'registration_audit_log is append-only: % not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_registration_audit_log_no_update ON registration_audit_log;
DROP TRIGGER IF EXISTS trg_registration_audit_log_no_delete ON registration_audit_log;
CREATE TRIGGER trg_registration_audit_log_no_update
BEFORE UPDATE ON registration_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_registration_audit_log_mutation();
CREATE TRIGGER trg_registration_audit_log_no_delete
BEFORE DELETE ON registration_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_registration_audit_log_mutation();

