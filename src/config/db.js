const path = require('path');
const fs = require('fs');
const mockDb = require('./mockDb');

const isMockMode = process.env.MOCK_MODE === 'true';
const databaseUrl = process.env.DATABASE_URL || '';

const isPostgres = !isMockMode && (
  databaseUrl.startsWith('postgres://') ||
  databaseUrl.startsWith('postgresql://')
);

const isSqlite = !isMockMode && !isPostgres;

let pool = null;
let sqliteDb = null;

if (isMockMode) {
  console.log('💡 [Mock Mode] Using in-memory database store (no PostgreSQL or SQLite connection needed).');
} else if (isPostgres) {
  const { Pool } = require('pg');
  const isCloudPostgres = (
    process.env.NODE_ENV === 'production' ||
    databaseUrl.includes('supabase') ||
    databaseUrl.includes('neon.tech') ||
    databaseUrl.includes('render.com') ||
    databaseUrl.includes('railway') ||
    databaseUrl.includes('sslmode=require')
  );

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: isCloudPostgres ? { rejectUnauthorized: false } : false
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
  console.log('🐘 Using PostgreSQL database connection.');
} else {
  // SQLite Mode (Default for local development & single-instance deployments)
  const sqlite3 = require('sqlite3').verbose();
  const sqliteDbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../data/temple.db');
  const dataDir = path.dirname(sqliteDbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sqliteDb = new sqlite3.Database(sqliteDbPath, (err) => {
    if (err) {
      console.error('❌ Failed to connect to SQLite database:', err.message);
    } else {
      console.log(`🗄️ Using persistent SQLite database at: ${sqliteDbPath}`);
      // Auto-initialize schema if needed
      initSqlite(sqliteDb);
    }
  });
}

function initSqlite(dbInstance) {
  const schemaPath = path.join(__dirname, '../../db/schema_sqlite.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    dbInstance.exec(sql, (err) => {
      if (err) {
        console.error('⚠️ SQLite schema initialization error:', err.message);
      }
    });
  }
}

/**
 * Translates PostgreSQL parameterized query ($1, $2, ...) to SQLite (?)
 */
function translatePgQueryToSqlite(sql, params) {
  if (!params || params.length === 0) {
    return { sql, params: [] };
  }
  const newParams = [];
  const translatedSql = sql.replace(/\$([0-9]+)/g, (match, p1) => {
    const idx = parseInt(p1, 10) - 1;
    newParams.push(params[idx]);
    return '?';
  });
  return { sql: translatedSql, params: newParams };
}

/**
 * Executes a query against SQLite
 */
function sqliteQuery(text, params = []) {
  return new Promise((resolve, reject) => {
    if (!sqliteDb) {
      return reject(new Error('SQLite database is not initialized'));
    }

    const { sql, params: mappedParams } = translatePgQueryToSqlite(text, params);
    const trimmed = text.trim();
    const isReturning = /RETURNING/i.test(trimmed);
    const isSelect = /^SELECT/i.test(trimmed);

    if (isSelect || isReturning) {
      sqliteDb.all(sql, mappedParams, (err, rows) => {
        if (err) return reject(err);
        resolve({
          rows: rows || [],
          rowCount: rows ? rows.length : 0
        });
      });
    } else {
      sqliteDb.run(sql, mappedParams, function (err) {
        if (err) return reject(err);
        resolve({
          rows: [],
          rowCount: this.changes || 0,
          lastID: this.lastID
        });
      });
    }
  });
}

module.exports = {
  isMockMode,
  isPostgres,
  isSqlite,
  pool,
  sqliteDb,
  query: (text, params) => {
    if (isMockMode) {
      return mockDb.query(text, params);
    }
    if (isPostgres) {
      return pool.query(text, params);
    }
    return sqliteQuery(text, params);
  },
  getClient: async () => {
    if (isMockMode) {
      return mockDb.getClient();
    }
    if (isPostgres) {
      return pool.connect();
    }
    return {
      query: (text, params) => sqliteQuery(text, params),
      release: () => {}
    };
  }
};
