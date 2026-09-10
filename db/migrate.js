/**
 * Database Migration Script
 * Automatically applies schema to PostgreSQL or SQLite depending on environment configuration.
 * Run with: npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL || '';
  const isPostgres = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');

  if (isPostgres) {
    const { Pool } = require('pg');
    const isProduction = process.env.NODE_ENV === 'production' ||
      databaseUrl.includes('supabase') ||
      databaseUrl.includes('neon.tech') ||
      databaseUrl.includes('render.com') ||
      databaseUrl.includes('railway') ||
      databaseUrl.includes('sslmode=require');

    const pool = new Pool({
      connectionString: databaseUrl,
      ssl: isProduction ? { rejectUnauthorized: false } : false
    });

    try {
      console.log('🔄 Connecting to PostgreSQL database...');
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL database successfully.');

      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');

      console.log('🔄 Applying PostgreSQL schema migrations from db/schema.sql...');
      await client.query(schemaSql);
      // Backward-compatible: existing tables created before donation_amount existed
      await client.query(`ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0`);
      // Soft-archive columns (nullable; historical rows stay active with NULL)
      await client.query(`ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`);
      await client.query(`ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_by_admin_id BIGINT NULL`);
      await client.query(`ALTER TABLE IF EXISTS registrations ADD COLUMN IF NOT EXISTS archived_by_username VARCHAR(100) NULL`);
      // Append-only audit log (never purged by the application)
      await client.query(`CREATE TABLE IF NOT EXISTS registration_audit_log (
        id BIGSERIAL PRIMARY KEY,
        registration_db_id BIGINT NOT NULL,
        registration_id VARCHAR(32) NOT NULL,
        action VARCHAR(32) NOT NULL DEFAULT 'ARCHIVED',
        actor_admin_id BIGINT NULL,
        actor_username VARCHAR(100) NULL,
        reason TEXT NULL,
        snapshot_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_db_id ON registration_audit_log (registration_db_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_registration_audit_log_registration_id ON registration_audit_log (registration_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_registration_audit_log_action ON registration_audit_log (action)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_registrations_archived_at ON registrations (archived_at)`);
      // Database-level append-only guard (idempotent; application access only).
      await client.query(`CREATE OR REPLACE FUNCTION prevent_registration_audit_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'registration_audit_log is append-only: % not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql`);
      await client.query(`DROP TRIGGER IF EXISTS trg_registration_audit_log_no_update ON registration_audit_log;
        DROP TRIGGER IF EXISTS trg_registration_audit_log_no_delete ON registration_audit_log;
        CREATE TRIGGER trg_registration_audit_log_no_update
        BEFORE UPDATE ON registration_audit_log
        FOR EACH ROW
        EXECUTE FUNCTION prevent_registration_audit_log_mutation();
        CREATE TRIGGER trg_registration_audit_log_no_delete
        BEFORE DELETE ON registration_audit_log
        FOR EACH ROW
        EXECUTE FUNCTION prevent_registration_audit_log_mutation()`);
      console.log('✅ PostgreSQL schema migration completed successfully!');
      console.log('   - Table: registrations created/verified');
      console.log('   - Table: registration_members created/verified');
      console.log('   - Column: registrations.donation_amount verified');
      console.log('   - Columns: registrations.archived_at / archived_by_admin_id / archived_by_username verified');
      console.log('   - Table: registration_audit_log created/verified (append-only)');
      console.log('   - Indexes & triggers created/verified');

      client.release();
      await pool.end();
    } catch (error) {
      console.error('❌ PostgreSQL migration failed:', error.message);
      await pool.end();
      process.exit(1);
    }
  } else {
    // SQLite Migration
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../data/temple.db');
    const dataDir = path.dirname(dbPath);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`🔄 Applying SQLite schema migrations to ${dbPath}...`);
    const schemaPath = path.join(__dirname, 'schema_sqlite.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Could not open SQLite database:', err.message);
        process.exit(1);
      }
    });

    // Migration order matters: backfill columns on pre-existing tables FIRST,
    // because schema_sqlite.sql references the new columns (index on
    // archived_at) and would fail against a legacy table otherwise.
    const fail = (msg) => {
      console.error(msg);
      db.close();
      process.exit(1);
    };
    db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name='registrations'`, (tblErr, tables) => {
      if (tblErr) {
        fail(`❌ SQLite table check failed: ${tblErr.message}`);
        return;
      }
      const backfill = (done) => {
        if (!tables || tables.length === 0) {
          done();
          return;
        }
        db.all(`PRAGMA table_info(registrations)`, (pragmaErr, cols) => {
          if (pragmaErr) {
            fail(`❌ SQLite pragma check failed: ${pragmaErr.message}`);
            return;
          }
          const colNames = new Set((cols || []).map((c) => c.name));
          const alterations = [];
          // Backward-compatible: add donation_amount to pre-existing SQLite tables
          if (!colNames.has('donation_amount')) {
            alterations.push(`ALTER TABLE registrations ADD COLUMN donation_amount REAL NOT NULL DEFAULT 0`);
          }
          // Soft-archive columns (nullable; historical rows stay active with NULL)
          if (!colNames.has('archived_at')) {
            alterations.push(`ALTER TABLE registrations ADD COLUMN archived_at DATETIME NULL`);
          }
          if (!colNames.has('archived_by_admin_id')) {
            alterations.push(`ALTER TABLE registrations ADD COLUMN archived_by_admin_id INTEGER NULL`);
          }
          if (!colNames.has('archived_by_username')) {
            alterations.push(`ALTER TABLE registrations ADD COLUMN archived_by_username TEXT NULL`);
          }
          const runNext = (i) => {
            if (i >= alterations.length) {
              done();
              return;
            }
            db.run(alterations[i], (alterErr) => {
              if (alterErr) {
                fail(`❌ SQLite column migration failed: ${alterErr.message}`);
                return;
              }
              runNext(i + 1);
            });
          };
          runNext(0);
        });
      };
      backfill(() => {
        db.exec(schemaSql, (err) => {
          if (err) {
            fail(`❌ SQLite migration failed: ${err.message}`);
            return;
          }
          const auditSql = `CREATE TABLE IF NOT EXISTS registration_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          registration_db_id INTEGER NOT NULL,
          registration_id TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT 'ARCHIVED',
          actor_admin_id INTEGER NULL,
          actor_username TEXT NULL,
          reason TEXT NULL,
          snapshot_json TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`;
        const finish = () => {
          console.log('✅ SQLite schema migration completed successfully!');
          console.log('   - Table: registrations created/verified');
          console.log('   - Table: registration_members created/verified');
          console.log('   - Column: registrations.donation_amount verified');
          console.log('   - Columns: registrations.archived_at / archived_by_admin_id / archived_by_username verified');
          console.log('   - Table: registration_audit_log created/verified (append-only)');
          console.log('   - Indexes & triggers created/verified');
          db.close();
        };
        db.exec(auditSql, (auditErr) => {
          if (auditErr) {
            fail(`❌ SQLite audit-log migration failed: ${auditErr.message}`);
            return;
          }
          const guardSql = `CREATE TRIGGER IF NOT EXISTS trg_registration_audit_log_no_update
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
            END;`;
          db.exec(guardSql, (guardErr) => {
            if (guardErr) {
              fail(`❌ SQLite audit-guard migration failed: ${guardErr.message}`);
              return;
            }
            finish();
          });
        });
        });
      });
    });
  }
}

runMigration();
