-- ====================================================================
-- SQLite Database Schema for Nava Chandi Yagam Event Registration System
-- Stored in data/temple.db (or configured SQLite file path)
-- ====================================================================

-- 1. Main Registrations Table
CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    address TEXT,
    rasi TEXT,
    natchathiram TEXT,
    gothram TEXT,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    cashfree_order_id TEXT UNIQUE,
    amount REAL NOT NULL DEFAULT 1000.00,
    donation_amount REAL NOT NULL DEFAULT 0,
    archived_at DATETIME NULL,
    archived_by_admin_id INTEGER NULL,
    archived_by_username TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Registration Family Members Table (up to 4 members per registration)
CREATE TABLE IF NOT EXISTS registration_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    member_number INTEGER NOT NULL CHECK (member_number BETWEEN 1 AND 4),
    name TEXT NOT NULL,
    rasi TEXT,
    natchathiram TEXT,
    gothram TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_registrations_registration_id ON registrations (registration_id);
CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id);
CREATE INDEX IF NOT EXISTS idx_registrations_payment_status ON registrations (payment_status);
CREATE INDEX IF NOT EXISTS idx_registrations_archived_at ON registrations (archived_at);
CREATE INDEX IF NOT EXISTS idx_registrations_mobile ON registrations (mobile);
CREATE INDEX IF NOT EXISTS idx_registration_members_registration_id ON registration_members (registration_id);

-- 4. Trigger to automatically update updated_at on record changes
CREATE TRIGGER IF NOT EXISTS trigger_update_registrations_timestamp
AFTER UPDATE ON registrations
FOR EACH ROW
BEGIN
    UPDATE registrations SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- 5. Admin Users Table (Role-based: super_admin vs admin)
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);

-- 6. App Settings Table (canonical registration fee persistence)
-- Mirrors PostgreSQL app_settings for local SQLite testing.
CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Registration Audit Log (APPEND-ONLY historical evidence, SQLite variant:
-- snapshot_json is TEXT containing valid JSON). No application endpoint may
-- delete or purge audit-log rows.
CREATE TABLE IF NOT EXISTS registration_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_db_id INTEGER NOT NULL,
    registration_id TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'ARCHIVED',
    actor_admin_id INTEGER NULL,
    actor_username TEXT NULL,
    reason TEXT NULL,
    snapshot_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_db_id ON registration_audit_log (registration_db_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_id ON registration_audit_log (registration_id);
CREATE INDEX IF NOT EXISTS idx_registration_audit_log_action ON registration_audit_log (action);

-- 8. Database-level append-only guard for the audit log (SQLite variant).
-- Aborts any UPDATE or DELETE on registration_audit_log; INSERT/SELECT work.
-- Idempotent via IF NOT EXISTS. Same DBA caveat as PostgreSQL: a database
-- owner with infrastructure-level access can drop the guard; application
-- authorization cannot.
CREATE TRIGGER IF NOT EXISTS trg_registration_audit_log_no_update
BEFORE UPDATE ON registration_audit_log
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'registration_audit_log is append-only: UPDATE not allowed');
END;

CREATE TRIGGER IF NOT EXISTS trg_registration_audit_log_no_delete
BEFORE DELETE ON registration_audit_log
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'registration_audit_log is append-only: DELETE not allowed');
END;

