// Migraciones versionadas del esquema local (SQLite).
// La version aplicada se guarda en PRAGMA user_version. Cada migracion corre
// dentro de una transaccion: si algo falla (o se va la luz a la mitad), la
// base queda exactamente en la version anterior, nunca a medio migrar.
//
// Regla: nunca editar una migracion ya publicada; siempre agregar una nueva.

const LOCALS_SEED = require('./seed/locals.json');

// Tipos de usuario con los mismos IDs que la tabla user_types del sistema web.
const USER_TYPES = [
  { id: 1, name: 'administrador' },
  { id: 2, name: 'vendedor' },
  { id: 3, name: 'auditor' },
  { id: 4, name: 'local' },
  { id: 5, name: 'almacen' },
];

const AHORA_SQL = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

function tieneColumna(db, tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
}

function ensureColumn(db, tabla, columna, definicion) {
  if (!tieneColumna(db, tabla, columna)) {
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
  }
}

const migraciones = [
  // v1 - Esquema del prototipo inicial (antes de versionar). Usa IF NOT EXISTS
  // y ensureColumn para adoptar bases creadas por versiones anteriores.
  function v1_esquemaPrototipo(db) {
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

    ensureColumn(db, 'users', 'email', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'users', 'estado', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(db, 'customers', 'tipo_documento', "TEXT NOT NULL DEFAULT 'DNI'");
    ensureColumn(db, 'customers', 'direccion', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'customers', 'estado', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(db, 'products', 'categoria', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'products', 'marca', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'products', 'estado', 'INTEGER NOT NULL DEFAULT 1');
    ensureColumn(db, 'products', 'stock_minimo', 'REAL NOT NULL DEFAULT 0');

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_documento
        ON customers(documento) WHERE documento IS NOT NULL AND documento != '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_products_codigo_barras
        ON products(codigo_barras) WHERE codigo_barras IS NOT NULL AND codigo_barras != '';
    `);
  },

  // v2 - Iteracion XP 1: autenticacion local.
  // Tablas user_types, locals y users con la misma estructura/IDs que el
  // MySQL del sistema web (para que la sincronizacion de la Iteracion 4 sea
  // un mapeo 1 a 1), mas sesiones locales y bitacora de accesos.
  function v2_autenticacionLocal(db, { localId }) {
    db.exec(`
      CREATE TABLE user_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );

      CREATE TABLE locals (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        direccion TEXT NOT NULL DEFAULT '',
        zona INTEGER,
        serie TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );
    `);

    const insTipo = db.prepare('INSERT INTO user_types (id, name) VALUES (?, ?)');
    for (const t of USER_TYPES) insTipo.run(t.id, t.name);

    const insLocal = db.prepare(
      'INSERT INTO locals (id, name, direccion, zona, serie, active) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const l of LOCALS_SEED) insLocal.run(l.id, l.name, l.direccion, l.zona, l.serie, l.active);

    db.exec(`
      CREATE TABLE users_v2 (
        id INTEGER PRIMARY KEY,
        dni TEXT NOT NULL DEFAULT '',
        type INTEGER NOT NULL REFERENCES user_types(id),
        email TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
        firstname TEXT NOT NULL,
        lastname TEXT NOT NULL DEFAULT '',
        direccion TEXT NOT NULL DEFAULT '',
        fechanacimiento TEXT,
        phone TEXT NOT NULL DEFAULT '',
        local INTEGER REFERENCES locals(id),
        resetPass INTEGER NOT NULL DEFAULT 0,
        password TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );
    `);

    // Copia los usuarios del esquema del prototipo (rol admin/vendedor).
    const localValido = db.prepare('SELECT id FROM locals WHERE id = ?').get(localId) ? localId : null;
    db.prepare(`
      INSERT INTO users_v2 (id, type, email, username, status, firstname, local, password)
      SELECT id,
             CASE WHEN rol = 'admin' THEN 1 ELSE 2 END,
             COALESCE(email, ''),
             username,
             CASE WHEN estado = 0 THEN 0 ELSE 1 END,
             nombre,
             ?,
             password_hash
      FROM users
    `).run(localValido);

    db.exec(`
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
      CREATE INDEX idx_users_type ON users(type);
      CREATE INDEX idx_users_local ON users(local);

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_id INTEGER REFERENCES locals(id),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_reason TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE auth_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL CHECK (event IN (
          'login_ok', 'login_fallido', 'login_bloqueado', 'login_inactivo', 'logout', 'sesion_expirada'
        )),
        username TEXT,
        user_id INTEGER,
        local_id INTEGER,
        detalle TEXT,
        created_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_auth_log_synced ON auth_log(synced);
    `);
  },

  // v3 - Modulo de clientes alineado con customers / customer_types /
  // tipo_documento del web. Cada registro sincronizable lleva:
  //   id local (autoincremental), central_id (id en el web, NULL si se creo
  //   offline) y sync_pendiente (1 = falta subirlo al central).
  function v3_clientes(db) {
    db.exec(`
      CREATE TABLE customer_types (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );
      INSERT INTO customer_types (id, name) VALUES (1, 'persona'), (2, 'empresa'), (3, 'otros');

      CREATE TABLE tipo_documento (
        codigo TEXT PRIMARY KEY,
        descripcion TEXT NOT NULL
      );
      INSERT INTO tipo_documento (codigo, descripcion) VALUES
        ('0', 'SIN DOCUMENTO'), ('1', 'DNI'), ('4', 'CARNET DE EXTRANJERIA'), ('6', 'RUC'), ('7', 'PASAPORTE');

      CREATE TABLE customers_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        central_id INTEGER UNIQUE,
        name TEXT NOT NULL,
        tipo_documento TEXT NOT NULL REFERENCES tipo_documento(codigo),
        code TEXT NOT NULL DEFAULT '',
        type INTEGER NOT NULL REFERENCES customer_types(id),
        address TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
        sync_pendiente INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );

      INSERT INTO customers_v3 (id, name, tipo_documento, code, type, address, phone, status)
      SELECT id,
             nombre,
             CASE tipo_documento WHEN 'DNI' THEN '1' WHEN 'RUC' THEN '6' WHEN 'CE' THEN '4' ELSE '0' END,
             COALESCE(documento, ''),
             CASE WHEN tipo_documento = 'RUC' AND documento LIKE '20%' THEN 2 ELSE 1 END,
             COALESCE(direccion, ''),
             COALESCE(telefono, ''),
             CASE WHEN estado = 0 THEN 0 ELSE 1 END
      FROM customers;

      DROP TABLE customers;
      ALTER TABLE customers_v3 RENAME TO customers;
      CREATE UNIQUE INDEX idx_customers_code ON customers(code) WHERE code <> '';
      CREATE INDEX idx_customers_name ON customers(name);
      CREATE INDEX idx_customers_sync ON customers(sync_pendiente);
    `);
  },

  // v4 - Modulo de catalogo alineado con products / product_brands /
  // product_categories del web.
  //  - se_fracciona (1 = se vende por unidad suelta). En el web el campo es
  //    status_fraccion con el sentido INVERSO (1 = NO se fracciona).
  //  - precio_unidad / precio_fraccion = precio de la zona de esta sucursal
  //    (en el web viven en pricezona).
  //  - El stock es por sucursal y se guarda en FRACCIONES (entero): una caja
  //    de 100 tabletas con 3 sueltas = 103. Asi abrir una caja no requiere
  //    logica especial y no hay decimales. En el web son StockCaja +
  //    StockFraccion (tabla fraccionventa).
  //  - kardex: todo cambio de stock queda como movimiento (se sincroniza como
  //    "-5", no como "quedan 18", para no pisar ventas de otras cajas).
  function v4_catalogo(db, { localId }) {
    db.exec(`
      CREATE TABLE product_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        central_id INTEGER UNIQUE,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        sync_pendiente INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );

      CREATE TABLE product_brands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        central_id INTEGER UNIQUE,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        sync_pendiente INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL}
      );

      CREATE TABLE products_v4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        central_id INTEGER UNIQUE,
        name TEXT NOT NULL,
        brand INTEGER NOT NULL REFERENCES product_brands(id),
        category INTEGER REFERENCES product_categories(id),
        composicion TEXT NOT NULL DEFAULT '',
        presentacion TEXT NOT NULL DEFAULT '',
        forma_farm TEXT NOT NULL DEFAULT '',
        codigo_barras TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
        se_fracciona INTEGER NOT NULL DEFAULT 0 CHECK (se_fracciona IN (0, 1)),
        fraccion INTEGER NOT NULL DEFAULT 1 CHECK (fraccion >= 1),
        status_igv INTEGER NOT NULL DEFAULT 1 CHECK (status_igv IN (0, 1)),
        precio_compra REAL NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
        precio_unidad REAL NOT NULL DEFAULT 0 CHECK (precio_unidad >= 0),
        precio_fraccion REAL NOT NULL DEFAULT 0 CHECK (precio_fraccion >= 0),
        sync_pendiente INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        CHECK (se_fracciona = 1 OR fraccion = 1)
      );

      -- Las hijas apuntan a products_v4 (no a la tabla vieja): al hacer
      -- DROP products no se dispara el CASCADE, y el RENAME posterior
      -- actualiza estas referencias a "products" automaticamente.
      CREATE TABLE product_stock (
        product_id INTEGER NOT NULL REFERENCES products_v4(id) ON DELETE CASCADE,
        local_id INTEGER NOT NULL REFERENCES locals(id),
        stock INTEGER NOT NULL DEFAULT 0,
        stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
        updated_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        PRIMARY KEY (product_id, local_id)
      );

      CREATE TABLE kardex (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products_v4(id) ON DELETE CASCADE,
        local_id INTEGER NOT NULL REFERENCES locals(id),
        tipo TEXT NOT NULL CHECK (tipo IN ('inicial', 'carga_central', 'ajuste_entrada', 'ajuste_salida', 'venta')),
        cantidad INTEGER NOT NULL,
        saldo INTEGER NOT NULL,
        motivo TEXT NOT NULL DEFAULT '',
        referencia TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT ${AHORA_SQL},
        synced INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_kardex_producto ON kardex(product_id, local_id, id);
      CREATE INDEX idx_kardex_synced ON kardex(synced);
    `);

    // Categorias y marcas que venian como texto libre en el prototipo.
    db.exec(`
      INSERT INTO product_categories (name)
        SELECT DISTINCT UPPER(TRIM(categoria)) FROM products WHERE TRIM(COALESCE(categoria, '')) <> '';
      INSERT INTO product_brands (name) VALUES ('SIN MARCA');
      INSERT OR IGNORE INTO product_brands (name)
        SELECT DISTINCT UPPER(TRIM(marca)) FROM products WHERE TRIM(COALESCE(marca, '')) <> '';
    `);

    db.exec(`
      INSERT INTO products_v4 (id, name, brand, category, codigo_barras, status, precio_unidad)
      SELECT p.id,
             p.nombre,
             COALESCE((SELECT b.id FROM product_brands b WHERE b.name = UPPER(TRIM(p.marca))),
                      (SELECT b.id FROM product_brands b WHERE b.name = 'SIN MARCA')),
             (SELECT c.id FROM product_categories c WHERE c.name = UPPER(TRIM(p.categoria))),
             COALESCE(p.codigo_barras, ''),
             CASE WHEN p.estado = 0 THEN 0 ELSE 1 END,
             MAX(p.precio, 0)
      FROM products p;
    `);

    const localValido = db.prepare('SELECT id FROM locals WHERE id = ?').get(localId);
    if (localValido) {
      db.prepare(`
        INSERT INTO product_stock (product_id, local_id, stock, stock_minimo)
        SELECT id, ?, CAST(ROUND(stock) AS INTEGER), CAST(ROUND(MAX(stock_minimo, 0)) AS INTEGER) FROM products
      `).run(localId);
      db.prepare(`
        INSERT INTO kardex (product_id, local_id, tipo, cantidad, saldo, motivo)
        SELECT product_id, local_id, 'inicial', stock, stock, 'Stock del prototipo anterior'
        FROM product_stock WHERE stock <> 0
      `).run();
    }

    db.exec(`
      DROP TABLE products;
      ALTER TABLE products_v4 RENAME TO products;
      CREATE INDEX idx_products_name ON products(name);
      CREATE INDEX idx_products_brand ON products(brand);
      CREATE INDEX idx_products_category ON products(category);
      CREATE INDEX idx_products_codigo_barras ON products(codigo_barras) WHERE codigo_barras <> '';
    `);
  },
];

function versionActual(db) {
  return db.pragma('user_version', { simple: true });
}

function migrar(db, opciones = {}) {
  const aplicadas = [];
  for (let i = versionActual(db); i < migraciones.length; i++) {
    const migracion = migraciones[i];
    db.transaction(() => {
      migracion(db, opciones);
      db.pragma(`user_version = ${i + 1}`);
    })();
    aplicadas.push(migracion.name);
  }
  return aplicadas;
}

module.exports = { migrar, versionActual, USER_TYPES, VERSION_ESQUEMA: migraciones.length };
