// Base de datos local (SQLite) de la sucursal.
// El esquema se crea/actualiza con migraciones versionadas (ver migrations.js).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');
const { migrar } = require('./migrations');

const DB_PATH = process.env.BOTICA_DB_PATH || path.join(config.dataDir, 'sucursal.sqlite3');

if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL + synchronous=FULL: cada transaccion confirmada queda en disco aunque
// se corte la energia justo despues (riesgo identificado en el plan).
if (DB_PATH !== ':memory:') db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

migrar(db, { localId: config.localId });

function getState(key, def = null) {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? row.value : def;
}

function setState(key, value) {
  db.prepare(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

module.exports = { db, DB_PATH, getState, setState };
