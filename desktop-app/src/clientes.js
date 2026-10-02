// Modulo: Clientes (tabla customers alineada con el sistema web).
// Tipos de documento con codigos SUNAT: 0 sin documento, 1 DNI,
// 4 carne de extranjeria, 6 RUC, 7 pasaporte.

const { db } = require('./db');
const { paginar, patronLike } = require('./util');

const SIN_DOC = '0';
const DNI = '1';
const CE = '4';
const RUC = '6';
const PASAPORTE = '7';

const TIPO_PERSONA = 1;
const TIPO_EMPRESA = 2;
const TIPO_OTROS = 3;

// RUC: 11 digitos, prefijo valido y digito verificador (modulo 11 de SUNAT).
function rucValido(ruc) {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = factores.reduce((acc, f, i) => acc + f * Number(ruc[i]), 0);
  let digito = 11 - (suma % 11);
  if (digito === 10) digito = 0;
  if (digito === 11) digito = 1;
  return digito === Number(ruc[10]);
}

function validarDocumento(tipo, code) {
  switch (tipo) {
    case SIN_DOC:
      return code === '' ? null : 'Un cliente "sin documento" no lleva número de documento';
    case DNI:
      return /^\d{8}$/.test(code) ? null : 'El DNI debe tener 8 dígitos';
    case RUC:
      if (!/^\d{11}$/.test(code)) return 'El RUC debe tener 11 dígitos';
      return rucValido(code) ? null : 'El RUC no es válido (revisa el número: el dígito verificador no coincide)';
    case CE:
      return /^[A-Z0-9]{8,11}$/.test(code) ? null : 'El carné de extranjería debe tener de 8 a 11 letras o números';
    case PASAPORTE:
      return /^[A-Z0-9]{6,11}$/.test(code) ? null : 'El pasaporte debe tener de 6 a 11 letras o números';
    default:
      return 'Tipo de documento inválido';
  }
}

// Mismo criterio del web: RUC de persona juridica (20...) = empresa.
function tipoCliente(tipoDoc, code) {
  if (tipoDoc === RUC && code.startsWith('20')) return TIPO_EMPRESA;
  if (tipoDoc === SIN_DOC) return TIPO_OTROS;
  return TIPO_PERSONA;
}

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function normalizar(datos) {
  const tipoDoc = String(datos.tipoDocumento ?? datos.tipo_documento ?? DNI);
  return {
    name: texto(datos.name).toUpperCase(),
    tipo_documento: tipoDoc,
    code: texto(datos.code).toUpperCase(),
    address: texto(datos.address),
    phone: texto(datos.phone),
    email: texto(datos.email).toLowerCase(),
  };
}

function validar(d) {
  if (d.name.length < 2) return 'El nombre o razón social es obligatorio';
  if (d.name.length > 255) return 'El nombre no puede superar 255 caracteres';
  const errorDoc = validarDocumento(d.tipo_documento, d.code);
  if (errorDoc) return errorDoc;
  if (d.address.length > 200) return 'La dirección no puede superar 200 caracteres';
  if (d.phone && !/^\d{6,9}$/.test(d.phone)) return 'El teléfono debe tener de 6 a 9 dígitos';
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'El email no es válido';
  return null;
}

const SELECT_CLIENTE = `
  SELECT c.id, c.central_id, c.name, c.tipo_documento, td.descripcion AS tipo_documento_nombre,
         c.code, c.type, ct.name AS type_name, c.address, c.phone, c.email, c.status, c.sync_pendiente,
         c.created_at, c.updated_at
  FROM customers c
  JOIN tipo_documento td ON td.codigo = c.tipo_documento
  JOIN customer_types ct ON ct.id = c.type`;

function documentoDuplicado(code, excluirId = null) {
  if (!code) return null;
  return db.prepare('SELECT id, name FROM customers WHERE code = ? AND id IS NOT ?').get(code, excluirId);
}

// Busca por nombre (todas las palabras deben aparecer) o por documento.
function listar({ q = '', soloActivos = false, pagina = 1, porPagina = 25 } = {}) {
  const condiciones = [];
  const params = [];
  const busqueda = texto(q);
  if (busqueda) {
    const palabras = busqueda.split(' ').slice(0, 6);
    condiciones.push(`(c.code LIKE ? ESCAPE '\\' OR (${palabras.map(() => "c.name LIKE ? ESCAPE '\\'").join(' AND ')}))`);
    params.push(patronLike(busqueda, { inicio: true }), ...palabras.map((p) => patronLike(p)));
  }
  if (soloActivos) condiciones.push('c.status = 1');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return paginar(db, { select: SELECT_CLIENTE, where, params, orden: "c.name = '', c.name, c.id", pagina, porPagina }); // sin nombre al final
}

function obtener(id) {
  return db.prepare(`${SELECT_CLIENTE} WHERE c.id = ?`).get(Number(id)) || null;
}

function buscarPorDocumento(code) {
  const limpio = texto(code).toUpperCase();
  if (!limpio) return null;
  return db.prepare(`${SELECT_CLIENTE} WHERE c.code = ?`).get(limpio) || null;
}

function crear(datos, actor) {
  const d = normalizar(datos || {});
  const error = validar(d);
  if (error) return { ok: false, error };
  const dup = documentoDuplicado(d.code);
  if (dup) return { ok: false, error: `Ya existe un cliente con ese documento (${dup.name})`, clienteId: dup.id };

  const info = db.prepare(
    `INSERT INTO customers (name, tipo_documento, code, type, address, phone, email, status, sync_pendiente, created_by)
     VALUES (?,?,?,?,?,?,?,1,1,?)`
  ).run(d.name, d.tipo_documento, d.code, tipoCliente(d.tipo_documento, d.code), d.address, d.phone, d.email,
    actor ? actor.id : null);
  return { ok: true, id: Number(info.lastInsertRowid), cliente: obtener(info.lastInsertRowid) };
}

function actualizar(id, datos) {
  id = Number(id);
  if (!obtener(id)) return { ok: false, error: 'Cliente no encontrado' };
  const d = normalizar(datos || {});
  const error = validar(d);
  if (error) return { ok: false, error };
  const dup = documentoDuplicado(d.code, id);
  if (dup) return { ok: false, error: `Ya existe otro cliente con ese documento (${dup.name})` };

  db.prepare(
    `UPDATE customers SET name = ?, tipo_documento = ?, code = ?, type = ?, address = ?, phone = ?, email = ?,
       sync_pendiente = 1, updated_at = ?
     WHERE id = ?`
  ).run(d.name, d.tipo_documento, d.code, tipoCliente(d.tipo_documento, d.code), d.address, d.phone, d.email,
    new Date().toISOString(), id);
  return { ok: true, cliente: obtener(id) };
}

function cambiarEstado(id, estado) {
  const activar = estado === 1 || estado === true || estado === '1';
  const info = db.prepare('UPDATE customers SET status = ?, sync_pendiente = 1, updated_at = ? WHERE id = ?')
    .run(activar ? 1 : 0, new Date().toISOString(), Number(id));
  if (info.changes === 0) return { ok: false, error: 'Cliente no encontrado' };
  return { ok: true };
}

function listarTiposDocumento() {
  return db.prepare('SELECT codigo, descripcion FROM tipo_documento ORDER BY codigo').all();
}

module.exports = {
  listar, obtener, buscarPorDocumento, crear, actualizar, cambiarEstado, listarTiposDocumento,
  rucValido, validarDocumento, tipoCliente,
};
