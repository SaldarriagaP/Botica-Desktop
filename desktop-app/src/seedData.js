// Datos iniciales para que la terminal tenga algo con que trabajar.
// Usuarios de prueba: ADMIN01 / admin123 (administrador) | VEND01 / vendedor123 (vendedor)
// Las tablas de referencia (user_types, locals, customer_types, tipo_documento)
// las crean las migraciones. Para cargar el catalogo real usar
// "npm run importar -- <ruta a botica.sql>".

const bcrypt = require('bcryptjs');
const config = require('./config');

const users = [
  { id: 1, username: 'ADMIN01', password: 'admin123', dni: '10000001', firstname: 'Rosa', lastname: 'Administradora', type: 1 },
  { id: 2, username: 'VEND01', password: 'vendedor123', dni: '10000002', firstname: 'Luis', lastname: 'Vendedor', type: 2 },
];

const customers = [
  { name: 'CLIENTE VARIOS', tipo_documento: '0', code: '', type: 3 },
  { name: 'MARIA GONZALES ROJAS', tipo_documento: '1', code: '45678912', type: 1, phone: '999111222' },
  { name: 'SOLUCIONES EN INGENIERIA T&J E.I.R.L.', tipo_documento: '6', code: '20607015083', type: 2 },
];

const categorias = ['ANALGESICO', 'ANTIBACTERIANO', 'ANTIINFLAMATORIO', 'ANTIHISTAMINICO', 'SOLUCIONES'];
const marcas = ['GENERICO', 'MEDIFARMA', 'PORTUGAL', 'FARMINDUSTRIA'];

// stock en fracciones: 20 cajas x 100 = 2000
const products = [
  { id: 101, name: 'PARACETAMOL 500MG CJA X 100 TAB', brand: 'GENERICO', category: 'ANALGESICO', composicion: 'PARACETAMOL 500MG', presentacion: 'CJA X 100 TAB', forma_farm: 'TABLETAS', codigo_barras: '7750000000101', se_fracciona: 1, fraccion: 100, precio_compra: 18, precio_unidad: 25, precio_fraccion: 0.35, stock: 2000, stock_minimo: 300 },
  { id: 102, name: 'AMOXICILINA 500MG CJA X 100 CAP', brand: 'PORTUGAL', category: 'ANTIBACTERIANO', composicion: 'AMOXICILINA 500MG', presentacion: 'CJA X 100 CAP', forma_farm: 'CAPSULAS', codigo_barras: '7750000000102', se_fracciona: 1, fraccion: 100, precio_compra: 45, precio_unidad: 60, precio_fraccion: 0.8, stock: 600, stock_minimo: 200 },
  { id: 103, name: 'IBUPROFENO 400MG CJA X 100 TAB', brand: 'MEDIFARMA', category: 'ANTIINFLAMATORIO', composicion: 'IBUPROFENO 400MG', presentacion: 'CJA X 100 TAB', forma_farm: 'TABLETAS', codigo_barras: '7750000000103', se_fracciona: 1, fraccion: 100, precio_compra: 22, precio_unidad: 30, precio_fraccion: 0.4, stock: 1550, stock_minimo: 200 },
  { id: 104, name: 'LORATADINA 10MG CJA X 10 TAB', brand: 'FARMINDUSTRIA', category: 'ANTIHISTAMINICO', composicion: 'LORATADINA 10MG', presentacion: 'CJA X 10 TAB', forma_farm: 'TABLETAS', codigo_barras: '7750000000104', se_fracciona: 1, fraccion: 10, precio_compra: 3.5, precio_unidad: 5, precio_fraccion: 0.6, stock: 25, stock_minimo: 30 },
  { id: 105, name: 'CLORURO DE SODIO 0.9% FCO X 500ML', brand: 'MEDIFARMA', category: 'SOLUCIONES', composicion: 'CLORURO DE SODIO 0.9%', presentacion: 'FCO X 500ML', forma_farm: 'SOLUCION INYECTABLE', codigo_barras: '7750000000105', se_fracciona: 0, fraccion: 1, precio_compra: 4, precio_unidad: 6.5, precio_fraccion: 0, stock: 30, stock_minimo: 10 },
];

// Cada bloque se siembra solo si su tabla esta vacia (idempotente).
function seed(db) {
  const vacia = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n === 0;
  let sembrado = false;

  db.transaction(() => {
    if (vacia('users')) {
      const ins = db.prepare(
        `INSERT INTO users (id, dni, type, username, status, firstname, lastname, local, password)
         VALUES (?,?,?,?,1,?,?,?,?)`
      );
      for (const u of users) {
        ins.run(u.id, u.dni, u.type, u.username, u.firstname, u.lastname, config.localId,
          bcrypt.hashSync(u.password, config.auth.bcryptRounds));
      }
      sembrado = true;
    }

    if (vacia('customers')) {
      const ins = db.prepare('INSERT INTO customers (name, tipo_documento, code, type, phone) VALUES (?,?,?,?,?)');
      for (const c of customers) ins.run(c.name, c.tipo_documento, c.code, c.type, c.phone || '');
      sembrado = true;
    }

    if (vacia('products')) {
      const insCat = db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)');
      const insMarca = db.prepare('INSERT OR IGNORE INTO product_brands (name) VALUES (?)');
      categorias.forEach((c) => insCat.run(c));
      marcas.forEach((m) => insMarca.run(m));
      const idCat = (n) => db.prepare('SELECT id FROM product_categories WHERE name = ?').get(n).id;
      const idMarca = (n) => db.prepare('SELECT id FROM product_brands WHERE name = ?').get(n).id;

      const ins = db.prepare(
        `INSERT INTO products (id, name, brand, category, composicion, presentacion, forma_farm, codigo_barras,
           se_fracciona, fraccion, precio_compra, precio_unidad, precio_fraccion)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      );
      const insStock = db.prepare('INSERT INTO product_stock (product_id, local_id, stock, stock_minimo) VALUES (?,?,?,?)');
      const insKardex = db.prepare(
        "INSERT INTO kardex (product_id, local_id, tipo, cantidad, saldo, motivo) VALUES (?, ?, 'inicial', ?, ?, 'Datos de demostracion')"
      );
      for (const p of products) {
        ins.run(p.id, p.name, idMarca(p.brand), idCat(p.category), p.composicion, p.presentacion, p.forma_farm,
          p.codigo_barras, p.se_fracciona, p.fraccion, p.precio_compra, p.precio_unidad, p.precio_fraccion);
        insStock.run(p.id, config.localId, p.stock, p.stock_minimo);
        insKardex.run(p.id, config.localId, p.stock, p.stock);
      }
      sembrado = true;
    }
  })();

  return sembrado;
}

module.exports = { seed, users };
