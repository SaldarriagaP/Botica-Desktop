// Modulo 4: Clientes
// TODO: traer/buscar clientes del servidor central

const { db } = require('./db');

const TIPOS_DOCUMENTO = ['DNI', 'RUC', 'CE', 'SIN_DOCUMENTO'];

function validarDocumento(tipo, documento) {
  documento = (documento || '').trim();
  if (!documento) return { ok: true, documento: '' };
  if (tipo === 'DNI' && !/^\d{8}$/.test(documento)) {
    return { ok: false, error: 'El DNI debe tener 8 dígitos' };
  }
  if (tipo === 'RUC' && !/^\d{11}$/.test(documento)) {
    return { ok: false, error: 'El RUC debe tener 11 dígitos' };
  }
  return { ok: true, documento };
}

function listar(busqueda = '', { soloActivos = false } = {}) {
  const condiciones = [];
  const params = [];
  if (busqueda) {
    condiciones.push('(nombre LIKE ? OR documento LIKE ?)');
    params.push(`%${busqueda}%`, `%${busqueda}%`);
  }
  if (soloActivos) condiciones.push('estado = 1');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM customers ${where} ORDER BY nombre`).all(...params);
}

function crear({ nombre, tipoDocumento, documento, telefono, direccion }) {
  nombre = (nombre || '').trim();
  tipoDocumento = tipoDocumento || 'DNI';

  if (!nombre) return { ok: false, error: 'El nombre es obligatorio' };
  if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) return { ok: false, error: 'Tipo de documento inválido' };

  const validacion = validarDocumento(tipoDocumento, documento);
  if (!validacion.ok) return validacion;

  try {
    const info = db.prepare(
      'INSERT INTO customers (nombre, tipo_documento, documento, telefono, direccion, estado) VALUES (?,?,?,?,?,1)'
    ).run(nombre, tipoDocumento, validacion.documento, (telefono || '').trim(), (direccion || '').trim());
    return { ok: true, id: info.lastInsertRowid };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, error: 'Ya existe un cliente con ese documento' };
    }
    throw err;
  }
}

function actualizar(id, { nombre, tipoDocumento, documento, telefono, direccion }) {
  nombre = (nombre || '').trim();
  tipoDocumento = tipoDocumento || 'DNI';

  if (!nombre) return { ok: false, error: 'El nombre es obligatorio' };
  if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) return { ok: false, error: 'Tipo de documento inválido' };

  const validacion = validarDocumento(tipoDocumento, documento);
  if (!validacion.ok) return validacion;

  try {
    const info = db.prepare(
      'UPDATE customers SET nombre = ?, tipo_documento = ?, documento = ?, telefono = ?, direccion = ? WHERE id = ?'
    ).run(nombre, tipoDocumento, validacion.documento, (telefono || '').trim(), (direccion || '').trim(), id);
    if (info.changes === 0) return { ok: false, error: 'Cliente no encontrado' };
    return { ok: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, error: 'Ya existe un cliente con ese documento' };
    }
    throw err;
  }
}

function cambiarEstado(id, estado) {
  const info = db.prepare('UPDATE customers SET estado = ? WHERE id = ?').run(estado ? 1 : 0, id);
  if (info.changes === 0) return { ok: false, error: 'Cliente no encontrado' };
  return { ok: true };
}

module.exports = { listar, crear, actualizar, cambiarEstado, TIPOS_DOCUMENTO };
