// Utilidades compartidas por los modulos de consulta.

// Patron para LIKE escapando los comodines que escriba el usuario (% y _).
function patronLike(valor, { inicio = false } = {}) {
  const escapado = String(valor).replace(/[\\%_]/g, (c) => `\\${c}`);
  return inicio ? `${escapado}%` : `%${escapado}%`;
}

// Ejecuta una consulta paginada. Devuelve { items, total, pagina, porPagina, paginas }.
function paginar(db, { select, where = '', params = [], orden, pagina = 1, porPagina = 25 }) {
  const tam = Math.min(Math.max(parseInt(porPagina, 10) || 25, 1), 100);
  let pag = Math.max(parseInt(pagina, 10) || 1, 1);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${select} ${where})`).get(...params).n;
  const paginas = Math.max(Math.ceil(total / tam), 1);
  if (pag > paginas) pag = paginas;

  const items = db.prepare(`${select} ${where} ORDER BY ${orden} LIMIT ? OFFSET ?`).all(...params, tam, (pag - 1) * tam);
  return { items, total, pagina: pag, porPagina: tam, paginas };
}

module.exports = { patronLike, paginar };
