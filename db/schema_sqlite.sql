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

