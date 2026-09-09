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
      console.log('✅ PostgreSQL schema migration completed successfully!');
      console.log('   - Table: registrations created/verified');
      console.log('   - Table: registration_members created/verified');
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

    db.exec(schemaSql, (err) => {
      if (err) {
        console.error('❌ SQLite migration failed:', err.message);
        db.close();
        process.exit(1);
      }
      console.log('✅ SQLite schema migration completed successfully!');
      console.log('   - Table: registrations created/verified');
      console.log('   - Table: registration_members created/verified');
      console.log('   - Indexes & triggers created/verified');
      db.close();
    });
  }
}

runMigration();
