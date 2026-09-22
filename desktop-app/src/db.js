const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sucursal.sqlite3');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

// Inicializar tablas y usuarios en secuencia estricta
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'vendedor'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      documento TEXT,
      telefono TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      codigo_barras TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      abierta INTEGER NOT NULL DEFAULT 0,
      monto_apertura REAL,
      monto_cierre REAL,
      usuario TEXT,
      opened_at TEXT,
      closed_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      cliente_id INTEGER,
      usuario TEXT,
      items_json TEXT NOT NULL,
      total REAL NOT NULL,
      sincronizado INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
});

function getState(key, callback) {
  db.get('SELECT value FROM sync_state WHERE key = ?', [key], (err, row) => {
    if (callback) callback(row ? row.value : null);
  });
}

function setState(key, value) {
  db.run(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

module.exports = { db, DB_PATH, getState, setState };