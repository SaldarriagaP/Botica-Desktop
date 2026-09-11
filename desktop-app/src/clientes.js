// Modulo 4: Clientes
// TODO: validar documento, buscar/traer clientes del servidor central

const { db } = require('./db');

function listar(busqueda = '') {
  if (!busqueda) return db.prepare('SELECT * FROM customers ORDER BY nombre').all();
  return db.prepare('SELECT * FROM customers WHERE nombre LIKE ? OR documento LIKE ? ORDER BY nombre')
    .all(`%${busqueda}%`, `%${busqueda}%`);
}

function crear({ nombre, documento, telefono }) {
  const info = db.prepare('INSERT INTO customers (nombre, documento, telefono) VALUES (?,?,?)')
    .run(nombre, documento || '', telefono || '');
  return { ok: true, id: info.lastInsertRowid };
}

module.exports = { listar, crear };
