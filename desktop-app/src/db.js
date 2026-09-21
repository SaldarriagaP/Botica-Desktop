// Base de datos local (SQLite) de la sucursal.
// Por ahora es un esquema bien simple, solo para tener el prototipo
// funcionando de punta a punta. Falta pulir varias cosas (ver README).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sucursal.sqlite3');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'vendedor'
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  documento TEXT,
  telefono TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  precio REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  codigo_barras TEXT
);

CREATE TABLE IF NOT EXISTS caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abierta INTEGER NOT NULL DEFAULT 0,
  monto_apertura REAL,
  monto_cierre REAL,
  usuario TEXT,
  opened_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  cliente_id INTEGER,
  usuario TEXT,
  items_json TEXT NOT NULL,
  total REAL NOT NULL,
  sincronizado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// Migraciones simples: agrega columnas nuevas a bases de datos que ya
// existían con el esquema viejo, sin perder los datos guardados.
function ensureColumn(table, column, definition) {
  const columnas = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columnas.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'email', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'estado', 'INTEGER NOT NULL DEFAULT 1');

ensureColumn('customers', 'tipo_documento', "TEXT NOT NULL DEFAULT 'DNI'");
ensureColumn('customers', 'direccion', "TEXT NOT NULL DEFAULT ''");
ensureColumn('customers', 'estado', 'INTEGER NOT NULL DEFAULT 1');

ensureColumn('products', 'categoria', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'marca', "TEXT NOT NULL DEFAULT ''");
ensureColumn('products', 'estado', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'stock_minimo', 'REAL NOT NULL DEFAULT 0');

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_documento
  ON customers(documento) WHERE documento IS NOT NULL AND documento != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_codigo_barras
  ON products(codigo_barras) WHERE codigo_barras IS NOT NULL AND codigo_barras != '';
`);

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
