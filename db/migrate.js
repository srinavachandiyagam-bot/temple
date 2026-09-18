/**
 * Database Migration Script – PhonePe + Donation compat
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
      // Backward-compatible: existing tables created before donation_amount/phonepe existed
      const pgAdds = [
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS donation_amount NUMERIC(10, 2) NOT NULL DEFAULT 0",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phonepe_merchant_order_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phonepe_order_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phonepe_transaction_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS cashfree_order_id VARCHAR(100)"
      ];
      for (const sql of pgAdds) {
        try { await client.query(sql); } catch (e) { console.warn('⚠️ PG add column warn:', e.message); }
      }
      try { await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_phonepe_merchant_order_id ON registrations (phonepe_merchant_order_id)"); } catch(e) {}
      try { await client.query("CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id)"); } catch(e) {}
      // Migrate legacy cashfree ids to phonepe
      try { await client.query("UPDATE registrations SET phonepe_merchant_order_id = cashfree_order_id WHERE phonepe_merchant_order_id IS NULL AND cashfree_order_id IS NOT NULL"); } catch(e) {}
      console.log('✅ PostgreSQL schema migration completed successfully!');
      console.log('   - Table: registrations created/verified');
      console.log('   - Table: registration_members created/verified');
      console.log('   - Columns: donation_amount, phonepe_merchant_order_id etc. verified');

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

    db.exec(schemaSql, (err) => {
      if (err) {
        console.error('❌ SQLite migration failed:', err.message);
        db.close();
        process.exit(1);
      }
      db.all(`PRAGMA table_info(registrations)`, (pragmaErr, cols) => {
        if (pragmaErr) {
          console.error('❌ SQLite pragma check failed:', pragmaErr.message);
          db.close();
          process.exit(1);
          return;
        }
        const existing = new Set((cols || []).map(c => c.name));
        const pending = [];
        if (!existing.has('donation_amount')) pending.push({ col: 'donation_amount', sql: `ALTER TABLE registrations ADD COLUMN donation_amount REAL NOT NULL DEFAULT 0` });
        if (!existing.has('phonepe_merchant_order_id')) pending.push({ col: 'phonepe_merchant_order_id', sql: `ALTER TABLE registrations ADD COLUMN phonepe_merchant_order_id TEXT` });
        if (!existing.has('phonepe_order_id')) pending.push({ col: 'phonepe_order_id', sql: `ALTER TABLE registrations ADD COLUMN phonepe_order_id TEXT` });
        if (!existing.has('phonepe_transaction_id')) pending.push({ col: 'phonepe_transaction_id', sql: `ALTER TABLE registrations ADD COLUMN phonepe_transaction_id TEXT` });
        if (!existing.has('cashfree_order_id')) pending.push({ col: 'cashfree_order_id', sql: `ALTER TABLE registrations ADD COLUMN cashfree_order_id TEXT` });

        if (pending.length === 0) {
          db.run("CREATE INDEX IF NOT EXISTS idx_registrations_phonepe_merchant_order_id ON registrations (phonepe_merchant_order_id)", () => {
            db.run("CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id)", () => {
              console.log('✅ SQLite schema migration completed successfully!');
              db.close();
            });
          });
          return;
        }
        let idx = 0;
        function nextAlter() {
          if (idx >= pending.length) {
            db.run("UPDATE registrations SET phonepe_merchant_order_id = cashfree_order_id WHERE phonepe_merchant_order_id IS NULL AND cashfree_order_id IS NOT NULL", () => {
              db.run("CREATE INDEX IF NOT EXISTS idx_registrations_phonepe_merchant_order_id ON registrations (phonepe_merchant_order_id)", () => {
                db.run("CREATE INDEX IF NOT EXISTS idx_registrations_cashfree_order_id ON registrations (cashfree_order_id)", () => {
                  console.log('✅ SQLite schema migration completed with additive columns!');
                  pending.forEach(c => console.log(`   + Added column: ${c.col}`));
                  db.close();
                });
              });
            });
            return;
          }
          const col = pending[idx++];
          db.run(col.sql, (alterErr) => {
            if (alterErr && !String(alterErr.message).includes('duplicate column')) {
              console.warn(`⚠️ Could not add column ${col.col}:`, alterErr.message);
            } else {
              console.log(`   + Added column: ${col.col}`);
            }
            nextAlter();
          });
        }
        nextAlter();
      });
    });
  }
}

runMigration();
