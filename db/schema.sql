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

