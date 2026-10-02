// Carga inicial del catalogo y clientes desde un volcado MySQL del sistema
// web (botica.sql). Simula el primer "pull" de la sincronizacion: cada fila
// guarda su central_id, asi que se puede volver a ejecutar sin duplicar.

const { db } = require('./db');
const config = require('./config');

// ------------------------------------------------ lector de INSERTs MySQL

const ESCAPES = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };

// Devuelve todas las filas (arrays) de los INSERT INTO `tabla` VALUES (...),(...);
function leerFilas(sql, tabla) {
  const marca = `INSERT INTO \`${tabla}\` VALUES `;
  const filas = [];
  let desde = 0;

  for (;;) {
    let i = sql.indexOf(marca, desde);
    if (i === -1) break;
    i += marca.length;

    for (;;) {
      while (sql[i] === ' ' || sql[i] === '\n' || sql[i] === '\r') i++;
      if (sql[i] !== '(') throw new Error(`Formato inesperado en ${tabla} (posicion ${i})`);
      i++;
      const fila = [];
      for (;;) {
        const c = sql[i];
        if (c === "'") {
          let valor = '';
          i++;
          for (;;) {
            const ch = sql[i];
            if (ch === undefined) throw new Error(`Texto sin cerrar en ${tabla}`);
            if (ch === '\\') {
              const sig = sql[i + 1];
              valor += ESCAPES[sig] !== undefined ? ESCAPES[sig] : sig;
              i += 2;
            } else if (ch === "'" && sql[i + 1] === "'") {
              valor += "'";
              i += 2;
            } else if (ch === "'") {
              i++;
              break;
            } else {
              valor += ch;
              i++;
            }
          }
          fila.push(valor);
        } else {
          let fin = i;
          while (sql[fin] !== ',' && sql[fin] !== ')') fin++;
          const token = sql.slice(i, fin).trim();
          fila.push(token === 'NULL' ? null : Number(token));
          i = fin;
        }
        if (sql[i] === ',') { i++; continue; }
        if (sql[i] === ')') { i++; break; }
        throw new Error(`Formato inesperado en ${tabla} (posicion ${i})`);
      }
      filas.push(fila);
      if (sql[i] === ',') { i++; continue; }
      if (sql[i] === ';') { i++; break; }
      throw new Error(`Formato inesperado al final de una fila de ${tabla}`);
    }
    desde = i;
  }
  return filas;
}

// --------------------------------------------------------------- import

const ahora = () => new Date().toISOString();
const limpio = (v) => (v === null || v === undefined ? '' : String(v).trim().replace(/\s+/g, ' '));
const dinero = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : 0);

function tipoDocumentoDesdeCodigo(code) {
  if (code === '') return '0';
  if (/^\d{8}$/.test(code)) return '1';
  if (/^\d{11}$/.test(code)) return '6';
  return '4';
}

// Marcas/categorias. Si el web tiene dos nombres que solo se diferencian en
// espacios (ej. "PHARMEX SAC" y "PHARMEX   SAC") se fusionan en un solo
// registro local y se reportan para que se corrijan en el sistema web.
function importarMaestro(tabla, filas) {
  const porCentral = db.prepare(`SELECT id FROM ${tabla} WHERE central_id = ?`);
  const porNombre = db.prepare(`SELECT id, central_id FROM ${tabla} WHERE name = ?`);
  const actualizar = db.prepare(`UPDATE ${tabla} SET name = ?, central_id = ?, sync_pendiente = 0, updated_at = ? WHERE id = ?`);
  const insertar = db.prepare(`INSERT INTO ${tabla} (central_id, name, sync_pendiente) VALUES (?, ?, 0)`);
  const mapa = new Map();
  const r = { nuevos: 0, actualizados: 0, fusionados: [] };

  for (const [centralId, nombre] of filas) {
    const name = limpio(nombre).toUpperCase() || `SIN NOMBRE ${centralId}`;
    const mismoNombre = porNombre.get(name);
    const existente = porCentral.get(centralId);

    if (existente) {
      // Si al renombrar chocaria con otro registro, se conserva el nombre actual.
      const nombreFinal = mismoNombre && mismoNombre.id !== existente.id ? null : name;
      if (nombreFinal) actualizar.run(nombreFinal, centralId, ahora(), existente.id);
      mapa.set(centralId, existente.id);
      r.actualizados++;
    } else if (mismoNombre && mismoNombre.central_id === null) {
      actualizar.run(name, centralId, ahora(), mismoNombre.id); // creado localmente: se enlaza
      mapa.set(centralId, mismoNombre.id);
      r.actualizados++;
    } else if (mismoNombre) {
      mapa.set(centralId, mismoNombre.id);
      r.fusionados.push(`${name}: id web ${centralId} se une al id web ${mismoNombre.central_id}`);
    } else {
      mapa.set(centralId, Number(insertar.run(centralId, name).lastInsertRowid));
      r.nuevos++;
    }
  }
  return { mapa, ...r };
}

function importar(sql, { localId = config.localId, incluirClientes = true } = {}) {
  const local = db.prepare('SELECT id, name, zona FROM locals WHERE id = ?').get(localId);
  if (!local) throw new Error(`La sucursal ${localId} no existe`);

  const datos = {
    categorias: leerFilas(sql, 'product_categories'),
    marcas: leerFilas(sql, 'product_brands'),
    productos: leerFilas(sql, 'products'),
    precios: leerFilas(sql, 'pricezona'),
    stock: leerFilas(sql, 'fraccionventa'),
    clientes: incluirClientes ? leerFilas(sql, 'customers') : [],
  };
  if (!datos.productos.length) throw new Error('El archivo no contiene la tabla products del sistema web');

  const resumen = { sucursal: local.name, zona: local.zona };

  db.transaction(() => {
    const cat = importarMaestro('product_categories', datos.categorias);
    const mar = importarMaestro('product_brands', datos.marcas);
    resumen.categorias = { nuevas: cat.nuevos, actualizadas: cat.actualizados, fusionadas: cat.fusionados };
    resumen.marcas = { nuevas: mar.nuevos, actualizadas: mar.actualizados, fusionadas: mar.fusionados };

    // pricezona: (id, producto, zona, porcentaje, precio_unidad, precio_fraccion, ...)
    const precioZona = new Map();
    for (const f of datos.precios) if (f[2] === local.zona) precioZona.set(f[1], { unidad: f[4], fraccion: f[5] });

    // products: (id, name, brand, category, busqueda, status, status_fraccion, status_igv, fraccion,
    //   precio_compra, porcentaje, precio_unidad, precio_fraccion, created_at, updated_at,
    //   composicion, presentacion, forma_farm, codigo_barras, ...)
    const porCentral = db.prepare('SELECT id FROM products WHERE central_id = ?');
    const actualizar = db.prepare(
      `UPDATE products SET name = ?, brand = ?, category = ?, composicion = ?, presentacion = ?, forma_farm = ?,
         codigo_barras = ?, status = ?, se_fracciona = ?, fraccion = ?, status_igv = ?, precio_compra = ?,
         precio_unidad = ?, precio_fraccion = ?, sync_pendiente = 0, updated_at = ? WHERE id = ?`
    );
    const insertar = db.prepare(
      `INSERT INTO products (central_id, name, brand, category, composicion, presentacion, forma_farm, codigo_barras,
         status, se_fracciona, fraccion, status_igv, precio_compra, precio_unidad, precio_fraccion, sync_pendiente)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
    );
    const productoLocal = new Map();
    let sinMarca = null;
    resumen.productos = { nuevos: 0, actualizados: 0, conPrecioDeZona: 0 };

    for (const f of datos.productos) {
      const centralId = f[0];
      let brand = mar.mapa.get(f[2]);
      if (!brand) {
        sinMarca = sinMarca || db.prepare("SELECT id FROM product_brands WHERE name = 'SIN MARCA'").get()?.id
          || Number(db.prepare("INSERT INTO product_brands (name) VALUES ('SIN MARCA')").run().lastInsertRowid);
        brand = sinMarca;
      }
      const seFracciona = Number(f[6]) === 0 && Number(f[8]) > 1 ? 1 : 0; // web: status_fraccion 1 = NO fracciona
      const fraccion = seFracciona ? Math.round(Number(f[8])) : 1;
      const zona = precioZona.get(centralId);
      if (zona) resumen.productos.conPrecioDeZona++;
      const barras = limpio(f[18]);
      const valores = [
        limpio(f[1]).toUpperCase() || `PRODUCTO ${centralId}`,
        brand,
        cat.mapa.get(f[3]) || null,
        limpio(f[15]).toUpperCase(),
        limpio(f[16]).toUpperCase(),
        limpio(f[17]).toUpperCase(),
        barras === '0' || barras === '2147483647' ? '' : barras,
        Number(f[5]) === 1 ? 1 : 0,
        seFracciona,
        fraccion,
        Number(f[7]) === 0 ? 0 : 1,
        dinero(f[9]),
        dinero(zona ? zona.unidad : f[11]),
        seFracciona ? dinero(zona ? zona.fraccion : f[12]) : 0,
      ];
      const existente = porCentral.get(centralId);
      if (existente) {
        actualizar.run(...valores, ahora(), existente.id);
        productoLocal.set(centralId, { id: existente.id, fraccion });
        resumen.productos.actualizados++;
      } else {
        const id = Number(insertar.run(centralId, ...valores).lastInsertRowid);
        productoLocal.set(centralId, { id, fraccion });
        resumen.productos.nuevos++;
      }
    }

    // fraccionventa: (id, idProducto, idLocal, StockFraccion, StockCaja, ...)
    const stockActual = db.prepare('SELECT stock FROM product_stock WHERE product_id = ? AND local_id = ?');
    const upsertStock = db.prepare(
      `INSERT INTO product_stock (product_id, local_id, stock) VALUES (?, ?, ?)
       ON CONFLICT(product_id, local_id) DO UPDATE SET stock = excluded.stock, updated_at = ?`
    );
    const kardex = db.prepare(
      `INSERT INTO kardex (product_id, local_id, tipo, cantidad, saldo, motivo, referencia, created_at)
       VALUES (?, ?, 'carga_central', ?, ?, 'Carga inicial desde el sistema web', 'importacion', ?)`
    );
    resumen.stock = { productosConStock: 0, movimientos: 0 };
    for (const f of datos.stock) {
      if (f[2] !== localId) continue;
      const p = productoLocal.get(f[1]);
      if (!p) continue;
      const nuevo = Math.round(Number(f[4] || 0) * p.fraccion + Number(f[3] || 0));
      const anterior = stockActual.get(p.id, localId);
      const delta = nuevo - (anterior ? anterior.stock : 0);
      upsertStock.run(p.id, localId, nuevo, ahora());
      if (nuevo > 0) resumen.stock.productosConStock++;
      if (delta !== 0) {
        kardex.run(p.id, localId, delta, nuevo, ahora());
        resumen.stock.movimientos++;
      }
    }

    // customers: (id, name, code, address, type, created_at, updated_at)
    if (incluirClientes) {
      const porCentralC = db.prepare('SELECT id FROM customers WHERE central_id = ?');
      const porCodigo = db.prepare("SELECT id FROM customers WHERE code = ? AND code <> '' AND central_id IS NULL");
      const actualizarC = db.prepare(
        `UPDATE customers SET central_id = ?, name = ?, tipo_documento = ?, code = ?, type = ?, address = ?,
           sync_pendiente = 0, updated_at = ? WHERE id = ?`
      );
      const insertarC = db.prepare(
        `INSERT INTO customers (central_id, name, tipo_documento, code, type, address, sync_pendiente)
         VALUES (?,?,?,?,?,?,0)`
      );
      resumen.clientes = { nuevos: 0, actualizados: 0 };
      for (const f of datos.clientes) {
        const code = limpio(f[2]).toUpperCase();
        const valores = [
          limpio(f[1]).toUpperCase(),
          tipoDocumentoDesdeCodigo(code),
          code,
          [1, 2, 3].includes(f[4]) ? f[4] : 1,
          limpio(f[3]),
        ];
        const existente = porCentralC.get(f[0]) || (code ? porCodigo.get(code) : null);
        if (existente) {
          actualizarC.run(f[0], ...valores, ahora(), existente.id);
          resumen.clientes.actualizados++;
        } else {
          insertarC.run(f[0], ...valores);
          resumen.clientes.nuevos++;
        }
      }
    }
  })();

  return resumen;
}

module.exports = { leerFilas, importar, tipoDocumentoDesdeCodigo };
