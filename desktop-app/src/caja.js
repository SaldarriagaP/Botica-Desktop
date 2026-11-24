// Modulo: Caja (apertura, resumen y cierre de turno con cuadre).
//
// Una terminal tiene como maximo un turno abierto. Al cerrar se calcula el
// efectivo esperado (apertura + ventas en efectivo - vueltos ya descontados)
// y se guarda la diferencia contra lo contado fisicamente.

const { db } = require('./db');
const config = require('./config');

const round2 = (n) => Math.round(n * 100) / 100;
const ahora = () => new Date().toISOString();
const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function montoValido(valor) {
  if (valor === '' || valor === null || valor === undefined) return NaN;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? round2(n) : NaN;
}

// Totales de un turno agrupados por medio de pago. "efectivo" y "tarjeta"
// suman lo cobrado por cada via (un multipago aporta a las dos).
function resumen(cajaId) {
  const filas = db.prepare(
    `SELECT medio_pago, COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total
     FROM sales WHERE caja_id = ? GROUP BY medio_pago ORDER BY medio_pago`
  ).all(cajaId);
  const porMedio = filas.map((f) => ({ ...f, total: round2(f.total) }));
  const vias = db.prepare(
    `SELECT COALESCE(SUM(pago_efectivo), 0) AS efectivo, COALESCE(SUM(pago_tarjeta), 0) AS tarjeta
     FROM sales WHERE caja_id = ?`
  ).get(cajaId);
  return {
    ventas: porMedio.reduce((a, f) => a + f.ventas, 0),
    total: round2(porMedio.reduce((a, f) => a + f.total, 0)),
    efectivo: round2(vias.efectivo),
    tarjeta: round2(vias.tarjeta),
    porMedio,
  };
}

function conResumen(turno) {
  if (!turno) return null;
  const r = resumen(turno.id);
  return { ...turno, resumen: r, efectivo_esperado: round2(turno.monto_apertura + r.efectivo) };
}

function estado() {
  const turno = db.prepare('SELECT * FROM caja WHERE abierta = 1 ORDER BY id DESC LIMIT 1').get();
  return conResumen(turno);
}

function abrir(actor, montoApertura) {
  if (!actor || !actor.nombre) return { ok: false, error: 'Falta el usuario que abre la caja' };
  const monto = montoValido(montoApertura);
  if (Number.isNaN(monto)) return { ok: false, error: 'El monto de apertura debe ser un número válido y no negativo' };

  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM caja WHERE abierta = 1').get()) return { ok: false, error: 'Ya hay una caja abierta' };
    const info = db.prepare(
      'INSERT INTO caja (abierta, monto_apertura, usuario, user_id, local_id, opened_at) VALUES (1, ?, ?, ?, ?, ?)'
    ).run(monto, actor.nombre, actor.id || null, config.localId, ahora());
    return { ok: true, id: Number(info.lastInsertRowid) };
  })();
}

// Cierre como en el web: se declara el efectivo contado y el total de
// tarjeta (vouchers). Si no se declara tarjeta se asume lo registrado.
function cerrar(montoCierre, { tarjeta = null, observacion = '', actor = null } = {}) {
  const monto = montoValido(montoCierre);
  if (Number.isNaN(monto)) return { ok: false, error: 'El monto de efectivo debe ser un número válido y no negativo' };
  const declaraTarjeta = !(tarjeta === null || tarjeta === undefined || tarjeta === '');
  const montoTarjeta = declaraTarjeta ? montoValido(tarjeta) : null;
  if (declaraTarjeta && Number.isNaN(montoTarjeta)) {
    return { ok: false, error: 'El monto de tarjeta debe ser un número válido y no negativo' };
  }

  return db.transaction(() => {
    const actual = estado();
    if (!actual) return { ok: false, error: 'No hay caja abierta' };
    const tarjetaEsperada = actual.resumen.tarjeta;
    const tarjetaDeclarada = declaraTarjeta ? montoTarjeta : tarjetaEsperada;
    const diferencia = round2(monto - actual.efectivo_esperado);
    const diferenciaTarjeta = round2(tarjetaDeclarada - tarjetaEsperada);
    const obs = texto(observacion).slice(0, 300);
    if ((diferencia !== 0 || diferenciaTarjeta !== 0) && obs.length < 5) {
      const partes = [];
      if (diferencia !== 0) partes.push(`efectivo: se esperaban S/ ${actual.efectivo_esperado.toFixed(2)} y declaraste S/ ${monto.toFixed(2)}`);
      if (diferenciaTarjeta !== 0) partes.push(`tarjeta: se esperaban S/ ${tarjetaEsperada.toFixed(2)} y declaraste S/ ${tarjetaDeclarada.toFixed(2)}`);
      return {
        ok: false,
        code: 'DESCUADRE',
        error: `La caja no cuadra (${partes.join('; ')}). Explica la diferencia en la observación para cerrar.`,
        esperado: actual.efectivo_esperado,
        diferencia,
        tarjetaEsperada,
        diferenciaTarjeta,
      };
    }
    db.prepare(
      `UPDATE caja SET abierta = 0, monto_cierre = ?, monto_esperado = ?, diferencia = ?, observacion = ?,
         tarjeta_declarada = ?, tarjeta_esperada = ?, closed_by = ?, closed_at = ? WHERE id = ?`
    ).run(monto, actual.efectivo_esperado, diferencia, obs, tarjetaDeclarada, tarjetaEsperada,
      actor ? actor.id : null, ahora(), actual.id);
    return {
      ok: true, id: actual.id, esperado: actual.efectivo_esperado, contado: monto, diferencia,
      tarjetaEsperada, tarjetaDeclarada, diferenciaTarjeta, resumen: actual.resumen,
    };
  })();
}

function historial({ limite = 30 } = {}) {
  const n = Math.min(Math.max(parseInt(limite, 10) || 30, 1), 200);
  return db.prepare(
    `SELECT id, usuario, monto_apertura, monto_cierre, monto_esperado, diferencia, observacion,
       tarjeta_declarada, tarjeta_esperada, opened_at, closed_at, abierta
     FROM caja ORDER BY id DESC LIMIT ?`
  ).all(n).map((t) => ({ ...t, resumen: resumen(t.id) }));
}

// Detalle de un turno (para el reporte imprimible de caja).
function obtener(id) {
  const t = db.prepare(
    `SELECT c.*, l.name AS local_nombre FROM caja c LEFT JOIN locals l ON l.id = c.local_id WHERE c.id = ?`
  ).get(Number(id));
  if (!t) return null;
  const r = resumen(t.id);
  return { ...t, resumen: r, efectivo_esperado: round2(t.monto_apertura + r.efectivo) };
}

module.exports = { estado, abrir, cerrar, historial, resumen, obtener };
