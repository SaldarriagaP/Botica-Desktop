// Base de datos local (SQLite) de la sucursal.
// El esquema se crea/actualiza con migraciones versionadas (ver migrations.js).

const path = require('path');
const fs = require('fs');

// better-sqlite3 solo trae binarios para Node 22+ en x64/arm64. Con un Node
// mas viejo el proceso muere con "Segmentation fault" sin ningun mensaje, asi
// que validamos antes de cargarlo para decir que hay que actualizar.
const nodeMayor = Number(process.versions.node.split('.')[0]);
if (nodeMayor < 22) {
  throw new Error(
    `Desktop Botica necesita Node.js 22 o mas nuevo (tienes ${process.version}). ` +
      'Instala Node 22+ desde https://nodejs.org, borra la carpeta node_modules y vuelve a correr "npm install".'
  );
}
if (!['x64', 'arm64'].includes(process.arch)) {
  throw new Error(
    `Desktop Botica necesita Node.js de 64 bits (tienes ${process.arch}). ` +
      'Instala la version x64 de Node 22+, borra node_modules y vuelve a correr "npm install".'
  );
}

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
