// Modulo: Catalogo de productos y stock de la sucursal.
//
// Unidades: el stock se guarda en la unidad minima de venta ("fraccion").
// Si un producto viene en caja x 100 tabletas y se fracciona, 1 caja = 100.
// Si no se fracciona, fraccion = 1 y el stock se cuenta por unidad/caja.
// precio_unidad = precio de la presentacion completa (caja); precio_fraccion
// = precio de la unidad suelta (igual que en el sistema web).

const { db } = require('./db');
const config = require('./config');
const { paginar, patronLike } = require('./util');

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const redondear2 = (n) => Math.round(n * 100) / 100;
const ahora = () => new Date().toISOString();

// ---------------------------------------------------------------- stock

function describirStock(stock, fraccion) {
  const signo = stock < 0 ? '-' : '';
  const abs = Math.abs(stock);
  if (fraccion <= 1) return { cajas: stock, sueltas: 0, texto: `${stock} und` };
  const cajas = Math.floor(abs / fraccion);
  const sueltas = abs % fraccion;
  const partes = [];
  if (cajas) partes.push(`${cajas} ${cajas === 1 ? 'caja' : 'cajas'}`);
  if (sueltas || !cajas) partes.push(`${sueltas} und`);
  return { cajas: stock < 0 ? -cajas : cajas, sueltas: stock < 0 ? -sueltas : sueltas, texto: signo + partes.join(' + ') };
}

// Unico punto que modifica el stock: siempre deja un movimiento en el kardex
// dentro de la misma transaccion (el que llama debe abrirla si agrupa varios).
function moverStock(productId, delta, tipo, { motivo = '', referencia = null, userId = null, localId = config.localId } = {}) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('El movimiento de stock debe ser un entero distinto de 0');
  db.prepare('INSERT OR IGNORE INTO product_stock (product_id, local_id) VALUES (?, ?)').run(productId, localId);
  db.prepare('UPDATE product_stock SET stock = stock + ?, updated_at = ? WHERE product_id = ? AND local_id = ?')
    .run(delta, ahora(), productId, localId);
  const { stock } = db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND local_id = ?').get(productId, localId);
  db.prepare(
    `INSERT INTO kardex (product_id, local_id, tipo, cantidad, saldo, motivo, referencia, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(productId, localId, tipo, delta, stock, motivo, referencia, userId, ahora());
  return stock;
}

// ---------------------------------------------------- marcas y categorias

function validarNombreMaestro(nombre) {
  const n = texto(nombre).toUpperCase();
  if (!/^[\p{L}0-9 .&()/+-]{2,100}$/u.test(n)) {
    return { ok: false, error: 'El nombre debe tener de 2 a 100 caracteres (letras, números, espacio, . - / & ( ) +)' };
  }
  return { ok: true, nombre: n };
}

function maestro(tabla, etiqueta) {
  return {
    listar() {
      return db.prepare(
        `SELECT t.id, t.name, (SELECT COUNT(*) FROM products p WHERE p.${etiqueta.campo} = t.id) AS productos
         FROM ${tabla} t ORDER BY t.name`
      ).all();
    },
    crear(nombre) {
      const v = validarNombreMaestro(nombre);
      if (!v.ok) return v;
      if (db.prepare(`SELECT 1 FROM ${tabla} WHERE name = ?`).get(v.nombre)) {
        return { ok: false, error: `Ya existe una ${etiqueta.singular} con ese nombre` };
      }
      const info = db.prepare(`INSERT INTO ${tabla} (name) VALUES (?)`).run(v.nombre);
      return { ok: true, id: Number(info.lastInsertRowid), name: v.nombre };
    },
    renombrar(id, nombre) {
      const v = validarNombreMaestro(nombre);
      if (!v.ok) return v;
      if (db.prepare(`SELECT 1 FROM ${tabla} WHERE name = ? AND id <> ?`).get(v.nombre, Number(id))) {
        return { ok: false, error: `Ya existe una ${etiqueta.singular} con ese nombre` };
      }
      const info = db.prepare(`UPDATE ${tabla} SET name = ?, sync_pendiente = 1, updated_at = ? WHERE id = ?`)
        .run(v.nombre, ahora(), Number(id));
      if (info.changes === 0) return { ok: false, error: `${etiqueta.singular[0].toUpperCase()}${etiqueta.singular.slice(1)} no encontrada` };
      return { ok: true };
    },
  };
}

const categorias = maestro('product_categories', { singular: 'categoría', campo: 'category' });
const marcas = maestro('product_brands', { singular: 'marca', campo: 'brand' });

// ----------------------------------------------------------- productos

const SELECT_PRODUCTO = `
  SELECT p.id, p.central_id, p.name, p.brand, b.name AS brand_name, p.category, c.name AS category_name,
         p.composicion, p.presentacion, p.forma_farm, p.codigo_barras, p.status, p.se_fracciona, p.fraccion,
         p.status_igv, p.precio_compra, p.precio_unidad, p.precio_fraccion, p.sync_pendiente,
         COALESCE(s.stock, 0) AS stock, COALESCE(s.stock_minimo, 0) AS stock_minimo
  FROM products p
  JOIN product_brands b ON b.id = p.brand
  LEFT JOIN product_categories c ON c.id = p.category
  LEFT JOIN product_stock s ON s.product_id = p.id AND s.local_id = ?`;

function enriquecer(p) {
  if (!p) return null;
  return {
    ...p,
    stock_bajo: p.stock_minimo > 0 && p.stock <= p.stock_minimo,
    stock_detalle: describirStock(p.stock, p.fraccion),
  };
}

function obtener(id) {
  return enriquecer(db.prepare(`${SELECT_PRODUCTO} WHERE p.id = ?`).get(config.localId, Number(id)));
}

// Filtros: q (todas las palabras en nombre/composicion/marca, o codigo de
// barras), categoria, marca, soloActivos, stock ('bajo' | 'sin' | 'con').
function listar({ q = '', categoria, marca, soloActivos = false, stock, pagina = 1, porPagina = 25 } = {}) {
  const condiciones = [];
  const params = [config.localId];
  const busqueda = texto(q);
  if (busqueda) {
    const palabras = busqueda.split(' ').slice(0, 6);
    const porPalabra = palabras.map(() => `(p.name || ' ' || p.composicion || ' ' || b.name) LIKE ? ESCAPE '\\'`);
    condiciones.push(`(p.codigo_barras = ? OR (${porPalabra.join(' AND ')}))`);
    params.push(busqueda, ...palabras.map((w) => patronLike(w)));
  }
  if (categoria) { condiciones.push('p.category = ?'); params.push(Number(categoria)); }
  if (marca) { condiciones.push('p.brand = ?'); params.push(Number(marca)); }
  if (soloActivos) condiciones.push('p.status = 1');
  if (stock === 'bajo') condiciones.push('COALESCE(s.stock_minimo, 0) > 0 AND COALESCE(s.stock, 0) <= s.stock_minimo');
  if (stock === 'sin') condiciones.push('COALESCE(s.stock, 0) <= 0');
  if (stock === 'con') condiciones.push('COALESCE(s.stock, 0) > 0');

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const r = paginar(db, { select: SELECT_PRODUCTO, where, params, orden: 'p.name, p.id', pagina, porPagina });
  r.items = r.items.map(enriquecer);
  return r;
}

function numero(valor, { entero = false } = {}) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = Number(valor);
  if (!Number.isFinite(n)) return NaN;
  return entero ? n : redondear2(n);
}

function normalizar(datos) {
  const seFracciona = datos.se_fracciona === true || datos.se_fracciona === 1 || datos.se_fracciona === '1';
  return {
    name: texto(datos.name).toUpperCase(),
    brand: Number(datos.brand),
    category: Number(datos.category),
    composicion: texto(datos.composicion).toUpperCase(),
    presentacion: texto(datos.presentacion).toUpperCase(),
    forma_farm: texto(datos.forma_farm).toUpperCase(),
    codigo_barras: texto(datos.codigo_barras),
    status_igv: datos.status_igv === 0 || datos.status_igv === '0' || datos.status_igv === false ? 0 : 1,
    se_fracciona: seFracciona ? 1 : 0,
    fraccion: seFracciona ? numero(datos.fraccion, { entero: true }) : 1,
    precio_compra: numero(datos.precio_compra),
    precio_unidad: numero(datos.precio_unidad),
    precio_fraccion: seFracciona ? numero(datos.precio_fraccion) : 0,
  };
}

function validar(d, idActual = null) {
  if (d.name.length < 2 || d.name.length > 255) return 'El nombre del producto es obligatorio (máx. 255 caracteres)';
  if (!db.prepare('SELECT 1 FROM product_brands WHERE id = ?').get(d.brand)) return 'Selecciona una marca / laboratorio válido';
  if (!db.prepare('SELECT 1 FROM product_categories WHERE id = ?').get(d.category)) return 'Selecciona una categoría válida';
  if (!d.composicion) return 'La composición es obligatoria';
  if (!d.presentacion) return 'La presentación es obligatoria (ej. CJA X 100 TAB)';
  if (!d.forma_farm) return 'La forma farmacéutica es obligatoria (ej. TABLETAS)';
  if (d.composicion.length > 100 || d.presentacion.length > 45 || d.forma_farm.length > 45) {
    return 'Composición (100), presentación (45) y forma farmacéutica (45) superan el máximo de caracteres';
  }
  if (d.codigo_barras && !/^[0-9A-Za-z-]{4,20}$/.test(d.codigo_barras)) return 'El código de barras debe tener de 4 a 20 letras o números';
  if (d.codigo_barras) {
    const dup = db.prepare('SELECT id, name FROM products WHERE codigo_barras = ? AND id IS NOT ?').get(d.codigo_barras, idActual);
    if (dup) return `El código de barras ya lo usa "${dup.name}"`;
  }
  if (d.se_fracciona && (!Number.isInteger(d.fraccion) || d.fraccion < 2 || d.fraccion > 10000)) {
    return 'Si el producto se fracciona, indica cuántas unidades trae (entre 2 y 10000)';
  }
  for (const campo of ['precio_compra', 'precio_unidad', 'precio_fraccion']) {
    if (!Number.isFinite(d[campo]) || d[campo] < 0 || d[campo] > 100000) return 'Los precios deben ser números entre 0 y 100000';
  }
  // Vender suelto nunca debe salir mas barato que vender la caja completa.
  if (d.se_fracciona && d.precio_unidad > 0 && d.precio_fraccion > 0
      && redondear2(d.precio_fraccion * d.fraccion) < d.precio_unidad) {
    return `El precio por unidad suelta × ${d.fraccion} (S/ ${(d.precio_fraccion * d.fraccion).toFixed(2)}) no puede ser menor que el precio de la caja (S/ ${d.precio_unidad.toFixed(2)})`;
  }
  return null;
}

function advertencias(d) {
  const out = [];
  if (d.precio_unidad === 0) out.push('El producto no tiene precio de venta: no se podrá vender hasta asignarlo.');
  if (d.precio_compra > 0 && d.precio_unidad > 0 && d.precio_unidad < d.precio_compra) {
    out.push('El precio de venta es menor que el precio de compra.');
  }
  return out;
}

function crear(datos, actor) {
  datos = datos || {};
  const d = normalizar(datos);
  const error = validar(d);
  if (error) return { ok: false, error };

  const stockMinimo = numero(datos.stock_minimo, { entero: true });
  if (!Number.isInteger(stockMinimo) || stockMinimo < 0) return { ok: false, error: 'El stock mínimo debe ser un entero mayor o igual a 0' };

  const id = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO products (name, brand, category, composicion, presentacion, forma_farm, codigo_barras, status,
         se_fracciona, fraccion, status_igv, precio_compra, precio_unidad, precio_fraccion, sync_pendiente)
       VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,1)`
    ).run(d.name, d.brand, d.category, d.composicion, d.presentacion, d.forma_farm, d.codigo_barras,
      d.se_fracciona, d.fraccion, d.status_igv, d.precio_compra, d.precio_unidad, d.precio_fraccion);
    const nuevoId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO product_stock (product_id, local_id, stock, stock_minimo) VALUES (?, ?, 0, ?)')
      .run(nuevoId, config.localId, stockMinimo);
    return nuevoId;
  })();

  return { ok: true, id, advertencias: advertencias(d), producto: obtener(id) };
}

function actualizar(id, datos) {
  id = Number(id);
  const actual = obtener(id);
  if (!actual) return { ok: false, error: 'Producto no encontrado' };
  const d = normalizar(datos || {});
  const error = validar(d, id);
  if (error) return { ok: false, error };

  // Cambiar la fraccion con stock cambiaria el significado del stock guardado.
  const cambiaFraccion = d.se_fracciona !== actual.se_fracciona || d.fraccion !== actual.fraccion;
  if (cambiaFraccion && actual.stock !== 0) {
    return { ok: false, error: 'No se puede cambiar la fracción de un producto con stock. Ajusta el stock a 0 primero.' };
  }

  db.prepare(
    `UPDATE products SET name = ?, brand = ?, category = ?, composicion = ?, presentacion = ?, forma_farm = ?,
       codigo_barras = ?, se_fracciona = ?, fraccion = ?, status_igv = ?, precio_compra = ?, precio_unidad = ?,
       precio_fraccion = ?, sync_pendiente = 1, updated_at = ?
     WHERE id = ?`
  ).run(d.name, d.brand, d.category, d.composicion, d.presentacion, d.forma_farm, d.codigo_barras, d.se_fracciona,
    d.fraccion, d.status_igv, d.precio_compra, d.precio_unidad, d.precio_fraccion, ahora(), id);
  return { ok: true, advertencias: advertencias(d), producto: obtener(id) };
}

function cambiarEstado(id, estado) {
  const activar = estado === 1 || estado === true || estado === '1';
  const info = db.prepare('UPDATE products SET status = ?, sync_pendiente = 1, updated_at = ? WHERE id = ?')
    .run(activar ? 1 : 0, ahora(), Number(id));
  if (info.changes === 0) return { ok: false, error: 'Producto no encontrado' };
  return { ok: true };
}

// Ajuste manual de stock (conteo fisico, merma, vencimiento, ingreso...).
// La cantidad se recibe como cajas + unidades sueltas.
function ajustarStock(id, { tipo, cajas = 0, sueltas = 0, motivo } = {}, actor) {
  const p = obtener(id);
  if (!p) return { ok: false, error: 'Producto no encontrado' };
  if (tipo !== 'entrada' && tipo !== 'salida') return { ok: false, error: 'Indica si el ajuste es de entrada o de salida' };

  cajas = Number(cajas || 0);
  sueltas = Number(sueltas || 0);
  if (!Number.isInteger(cajas) || !Number.isInteger(sueltas) || cajas < 0 || sueltas < 0) {
    return { ok: false, error: 'Las cantidades deben ser números enteros positivos' };
  }
  if (sueltas > 0 && !p.se_fracciona) return { ok: false, error: 'Este producto no se vende por unidades sueltas' };
  const cantidad = cajas * p.fraccion + sueltas;
  if (cantidad <= 0) return { ok: false, error: 'La cantidad debe ser mayor que 0' };
  if (cantidad > 1000000) return { ok: false, error: 'La cantidad es demasiado grande' };

  const m = texto(motivo);
  if (m.length < 5) return { ok: false, error: 'Explica el motivo del ajuste (mínimo 5 caracteres)' };

  const resultado = db.transaction(() => {
    // Se relee dentro de la transaccion para no validar contra un stock viejo.
    const { stock } = db.prepare('SELECT COALESCE(MAX(stock), 0) AS stock FROM product_stock WHERE product_id = ? AND local_id = ?')
      .get(p.id, config.localId);
    if (tipo === 'salida' && cantidad > stock) {
      return { ok: false, error: `No puedes retirar más de lo que hay (${describirStock(stock, p.fraccion).texto})` };
    }
    const saldo = moverStock(p.id, tipo === 'entrada' ? cantidad : -cantidad, tipo === 'entrada' ? 'ajuste_entrada' : 'ajuste_salida', {
      motivo: m,
      userId: actor ? actor.id : null,
    });
    return { ok: true, stock: saldo, stock_detalle: describirStock(saldo, p.fraccion) };
  })();
  return resultado;
}

function definirStockMinimo(id, minimo) {
  const p = obtener(id);
  if (!p) return { ok: false, error: 'Producto no encontrado' };
  const n = Number(minimo);
  if (!Number.isInteger(n) || n < 0 || n > 1000000) return { ok: false, error: 'El stock mínimo debe ser un entero mayor o igual a 0' };
  db.prepare(
    `INSERT INTO product_stock (product_id, local_id, stock_minimo) VALUES (?, ?, ?)
     ON CONFLICT(product_id, local_id) DO UPDATE SET stock_minimo = excluded.stock_minimo, updated_at = ?`
  ).run(p.id, config.localId, n, ahora());
  return { ok: true };
}

function kardex(id, { pagina = 1, porPagina = 25 } = {}) {
  const p = obtener(id);
  if (!p) return { ok: false, error: 'Producto no encontrado' };
  const r = paginar(db, {
    select: `SELECT k.id, k.tipo, k.cantidad, k.saldo, k.motivo, k.referencia, k.created_at,
                    TRIM(COALESCE(u.firstname, '') || ' ' || COALESCE(u.lastname, '')) AS usuario
             FROM kardex k LEFT JOIN users u ON u.id = k.user_id`,
    where: 'WHERE k.product_id = ? AND k.local_id = ?',
    params: [p.id, config.localId],
    orden: 'k.id DESC',
    pagina,
    porPagina,
  });
  r.items = r.items.map((k) => ({ ...k, cantidad_detalle: describirStock(k.cantidad, p.fraccion), saldo_detalle: describirStock(k.saldo, p.fraccion) }));
  return { ok: true, producto: { id: p.id, name: p.name, fraccion: p.fraccion }, ...r };
}

module.exports = {
  listar, obtener, crear, actualizar, cambiarEstado, ajustarStock, definirStockMinimo, kardex,
  moverStock, describirStock, categorias, marcas,
};
