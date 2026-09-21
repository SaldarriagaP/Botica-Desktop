// Modulo 5: Catalogo / stock
// TODO: venta por fraccion (por ahora todo se vende por unidad), IGV

const { db } = require('./db');

function listar(busqueda = '', { soloActivos = false } = {}) {
  const condiciones = [];
  const params = [];
  if (busqueda) {
    condiciones.push('(nombre LIKE ? OR codigo_barras LIKE ? OR categoria LIKE ? OR marca LIKE ?)');
    params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
  }
  if (soloActivos) condiciones.push('estado = 1');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM products ${where} ORDER BY nombre`).all(...params);
}

function validarDatos({ nombre, precio, stock, stockMinimo }) {
  if (!nombre || !nombre.trim()) return { ok: false, error: 'El nombre es obligatorio' };
  if (precio === undefined || Number(precio) < 0) return { ok: false, error: 'El precio no puede ser negativo' };
  if (stock === undefined || Number(stock) < 0) return { ok: false, error: 'El stock no puede ser negativo' };
  if (stockMinimo !== undefined && Number(stockMinimo) < 0) return { ok: false, error: 'El stock mínimo no puede ser negativo' };
  return { ok: true };
}

function crear({ nombre, categoria, marca, precio, stock, stockMinimo, codigoBarras }) {
  const validacion = validarDatos({ nombre, precio, stock, stockMinimo });
  if (!validacion.ok) return validacion;

  try {
    const info = db.prepare(
      `INSERT INTO products (nombre, categoria, marca, precio, stock, stock_minimo, codigo_barras, estado)
       VALUES (?,?,?,?,?,?,?,1)`
    ).run(
      nombre.trim(),
      (categoria || '').trim(),
      (marca || '').trim(),
      Number(precio),
      Number(stock),
      Number(stockMinimo || 0),
      (codigoBarras || '').trim()
    );
    return { ok: true, id: info.lastInsertRowid };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, error: 'Ya existe un producto con ese código de barras' };
    }
    throw err;
  }
}

function actualizar(id, { nombre, categoria, marca, precio, stock, stockMinimo, codigoBarras }) {
  const validacion = validarDatos({ nombre, precio, stock, stockMinimo });
  if (!validacion.ok) return validacion;

  try {
    const info = db.prepare(
      `UPDATE products SET nombre = ?, categoria = ?, marca = ?, precio = ?, stock = ?, stock_minimo = ?, codigo_barras = ?
       WHERE id = ?`
    ).run(
      nombre.trim(),
      (categoria || '').trim(),
      (marca || '').trim(),
      Number(precio),
      Number(stock),
      Number(stockMinimo || 0),
      (codigoBarras || '').trim(),
      id
    );
    if (info.changes === 0) return { ok: false, error: 'Producto no encontrado' };
    return { ok: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, error: 'Ya existe un producto con ese código de barras' };
    }
    throw err;
  }
}

function cambiarEstado(id, estado) {
  const info = db.prepare('UPDATE products SET estado = ? WHERE id = ?').run(estado ? 1 : 0, id);
  if (info.changes === 0) return { ok: false, error: 'Producto no encontrado' };
  return { ok: true };
}

function descontarStock(productId, cantidad) {
  db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(cantidad, productId);
}

module.exports = { listar, crear, actualizar, cambiarEstado, descontarStock };
