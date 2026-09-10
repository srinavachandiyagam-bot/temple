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
      // Additive migrations for Postgres (existing DBs)
      const pgAdds = [
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS cf_order_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS order_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_method VARCHAR(100)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_time TIMESTAMPTZ",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS bank_reference VARCHAR(255)",
        "ALTER TABLE registrations ADD COLUMN IF NOT EXISTS payment_message TEXT"
      ];
      for (const sql of pgAdds) {
        try { await client.query(sql); } catch (e) { console.warn('⚠️ PG add column warn:', e.message); }
      }
      try { await client.query("UPDATE registrations SET payment_status = UPPER(payment_status) WHERE payment_status IN ('pending','paid','failed','created','cancelled','expired')"); } catch(e){}
      try { await client.query("UPDATE registrations SET cf_order_id = cashfree_order_id WHERE cf_order_id IS NULL AND cashfree_order_id IS NOT NULL"); } catch(e){}
      try { await client.query("UPDATE registrations SET order_id = cashfree_order_id WHERE order_id IS NULL AND cashfree_order_id IS NOT NULL"); } catch(e){}
      console.log('✅ PostgreSQL schema migration completed successfully!');
      console.log('   - Table: registrations created/verified');
      console.log('   - Table: registration_members created/verified');
      console.log('   - Indexes & triggers created/verified');
      console.log('   + Ensured additive payment columns + uppercase status');

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
      // --- Additive migrations for existing DBs (safe ALTER TABLE) ---
      const extraColumns = [
        { col: 'cf_order_id', sql: 'ALTER TABLE registrations ADD COLUMN cf_order_id TEXT' },
        { col: 'order_id', sql: 'ALTER TABLE registrations ADD COLUMN order_id TEXT' },
        { col: 'payment_id', sql: 'ALTER TABLE registrations ADD COLUMN payment_id TEXT' },
        { col: 'payment_method', sql: 'ALTER TABLE registrations ADD COLUMN payment_method TEXT' },
        { col: 'payment_time', sql: 'ALTER TABLE registrations ADD COLUMN payment_time DATETIME' },
        { col: 'bank_reference', sql: 'ALTER TABLE registrations ADD COLUMN bank_reference TEXT' },
        { col: 'payment_message', sql: 'ALTER TABLE registrations ADD COLUMN payment_message TEXT' }
      ];
      db.all("PRAGMA table_info(registrations)", (pragmaErr, cols) => {
        if (pragmaErr) {
          console.warn('⚠️ Could not check existing columns:', pragmaErr.message);
          console.log('✅ SQLite schema migration completed (base)!');
          db.close();
          return;
        }
        const existing = new Set((cols || []).map(c => c.name));
        let pending = extraColumns.filter(c => !existing.has(c.col));
        if (pending.length === 0) {
          // Normalize legacy lowercase statuses to uppercase
          db.run("UPDATE registrations SET payment_status = UPPER(payment_status) WHERE payment_status IN ('pending','paid','failed','created','cancelled','expired')", () => {
            console.log('✅ SQLite schema migration completed successfully!');
            console.log('   - Table: registrations created/verified');
            console.log('   - Table: registration_members created/verified');
            console.log('   - Indexes & triggers created/verified');
            db.close();
          });
          return;
        }
        let idx = 0;
        function nextAlter() {
          if (idx >= pending.length) {
            db.run("UPDATE registrations SET payment_status = UPPER(payment_status) WHERE payment_status IN ('pending','paid','failed','created','cancelled','expired')", () => {
              // Sync cf_order_id/order_id with cashfree_order_id where null
              db.run("UPDATE registrations SET cf_order_id = cashfree_order_id WHERE cf_order_id IS NULL AND cashfree_order_id IS NOT NULL", () => {
                db.run("UPDATE registrations SET order_id = cashfree_order_id WHERE order_id IS NULL AND cashfree_order_id IS NOT NULL", () => {
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
