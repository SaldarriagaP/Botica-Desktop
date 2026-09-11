// Modulo 2: Caja (apertura / cierre de turno)
// TODO: cuadre real contra las ventas del turno, historial de turnos

const { db } = require('./db');

function estado() {
  return db.prepare('SELECT * FROM caja WHERE abierta = 1 ORDER BY id DESC LIMIT 1').get() || null;
}

function abrir(usuario, montoApertura) {
  if (estado()) return { ok: false, error: 'Ya hay una caja abierta' };
  const info = db.prepare(
    'INSERT INTO caja (abierta, monto_apertura, usuario, opened_at) VALUES (1, ?, ?, ?)'
  ).run(montoApertura, usuario, new Date().toISOString());
  return { ok: true, id: info.lastInsertRowid };
}

function cerrar(montoCierre) {
  const actual = estado();
  if (!actual) return { ok: false, error: 'No hay caja abierta' };
  db.prepare('UPDATE caja SET abierta = 0, monto_cierre = ?, closed_at = ? WHERE id = ?')
    .run(montoCierre, new Date().toISOString(), actual.id);
  return { ok: true };
}

module.exports = { estado, abrir, cerrar };
