// Modulo 5: Catalogo / stock
// TODO: categorias, marcas, venta por fraccion (por ahora todo se vende por unidad)

const { db } = require('./db');

function listar(busqueda = '') {
  if (!busqueda) return db.prepare('SELECT * FROM products ORDER BY nombre').all();
  return db.prepare('SELECT * FROM products WHERE nombre LIKE ? OR codigo_barras LIKE ? ORDER BY nombre')
    .all(`%${busqueda}%`, `%${busqueda}%`);
}

function descontarStock(productId, cantidad) {
  db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(cantidad, productId);
}

module.exports = { listar, descontarStock };
