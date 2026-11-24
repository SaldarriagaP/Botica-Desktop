const express = require('express');
const config = require('./config');
const { db } = require('./db');
const auth = require('./auth');
const usuarios = require('./usuarios');
const caja = require('./caja');
const clientes = require('./clientes');
const catalogo = require('./catalogo');
const ventas = require('./ventas');
const sync = require('./sync');
const resumen = require('./resumen');
const permisos = require('./permisos');
const { requireAuth, requirePermiso } = require('./middleware');

const router = express.Router();
const body = (req) => req.body || {};

// ---------- Rutas publicas ----------

// Datos de la terminal para la pantalla de login (sucursal configurada).
router.get('/terminal', (req, res) => {
  const local = db.prepare('SELECT id, name, direccion FROM locals WHERE id = ?').get(config.localId);
  res.json({ local });
});

router.post('/auth/login', (req, res) => {
  const { username, password } = body(req);
  const resultado = auth.login(username, password);
  if (!resultado.ok) return res.status(resultado.bloqueadoSegundos ? 429 : 401).json(resultado);
  res.json(resultado);
});

// ---------- A partir de aqui todo exige sesion valida ----------
router.use(requireAuth);

// ===== Autenticacion y usuarios =====
router.get('/auth/me', (req, res) => res.json({ ok: true, user: req.user }));
router.post('/auth/logout', (req, res) => res.json(auth.logout(req.token)));
router.post('/auth/cambiar-password', (req, res) =>
  res.json(auth.cambiarPassword(req.token, body(req).actual, body(req).nueva))
);

const gestionarUsuarios = requirePermiso('usuarios.gestionar');
router.get('/usuarios', gestionarUsuarios, (req, res) => res.json(usuarios.listar()));
router.post('/usuarios', gestionarUsuarios, (req, res) => res.json(usuarios.crear(body(req))));
router.put('/usuarios/:id', gestionarUsuarios, (req, res) => res.json(usuarios.actualizar(req.params.id, body(req), req.user)));
router.post('/usuarios/:id/estado', gestionarUsuarios, (req, res) =>
  res.json(usuarios.cambiarEstado(req.params.id, body(req).estado, req.user))
);
router.post('/usuarios/:id/restablecer-password', gestionarUsuarios, (req, res) =>
  res.json(usuarios.restablecerPassword(req.params.id, body(req).password, req.user))
);
router.get('/user-types', gestionarUsuarios, (req, res) => res.json(usuarios.listarTipos()));
router.get('/locales', gestionarUsuarios, (req, res) => res.json(usuarios.listarLocales({ soloActivos: true })));

// ===== Clientes =====
router.get('/clientes', requirePermiso('clientes.ver'), (req, res) =>
  res.json(clientes.listar({ q: req.query.q, soloActivos: req.query.soloActivos === '1', pagina: req.query.pagina, porPagina: req.query.porPagina }))
);
router.get('/clientes/tipos-documento', requirePermiso('clientes.ver'), (req, res) => res.json(clientes.listarTiposDocumento()));
router.get('/clientes/estadisticas', requirePermiso('clientes.ver'), (req, res) => res.json(clientes.estadisticas()));
router.get('/clientes/documento/:code', requirePermiso('clientes.ver'), (req, res) => {
  const cliente = clientes.buscarPorDocumento(req.params.code);
  res.status(cliente ? 200 : 404).json(cliente ? { ok: true, cliente } : { ok: false, error: 'No hay un cliente con ese documento' });
});
router.get('/clientes/:id', requirePermiso('clientes.ver'), (req, res) => {
  const cliente = clientes.obtener(req.params.id);
  res.status(cliente ? 200 : 404).json(cliente ? { ok: true, cliente } : { ok: false, error: 'Cliente no encontrado' });
});
router.post('/clientes', requirePermiso('clientes.crear'), (req, res) => res.json(clientes.crear(body(req), req.user)));
router.put('/clientes/:id', requirePermiso('clientes.editar'), (req, res) => res.json(clientes.actualizar(req.params.id, body(req))));
router.post('/clientes/:id/estado', requirePermiso('clientes.estado'), (req, res) =>
  res.json(clientes.cambiarEstado(req.params.id, body(req).estado))
);

// ===== Catalogo =====
const verCatalogo = requirePermiso('catalogo.ver');
const gestionarCatalogo = requirePermiso('catalogo.gestionar');

router.get('/productos', verCatalogo, (req, res) =>
  res.json(catalogo.listar({
    q: req.query.q,
    categoria: req.query.categoria,
    marca: req.query.marca,
    stock: req.query.stock,
    soloActivos: req.query.soloActivos === '1',
    pagina: req.query.pagina,
    porPagina: req.query.porPagina,
  }))
);
router.get('/productos/estadisticas', verCatalogo, (req, res) => res.json(catalogo.estadisticas()));
router.get('/productos/:id', verCatalogo, (req, res) => {
  const producto = catalogo.obtener(req.params.id);
  res.status(producto ? 200 : 404).json(producto ? { ok: true, producto } : { ok: false, error: 'Producto no encontrado' });
});
router.post('/productos', gestionarCatalogo, (req, res) => res.json(catalogo.crear(body(req), req.user)));
router.put('/productos/:id', gestionarCatalogo, (req, res) => res.json(catalogo.actualizar(req.params.id, body(req))));
router.post('/productos/:id/estado', gestionarCatalogo, (req, res) =>
  res.json(catalogo.cambiarEstado(req.params.id, body(req).estado))
);
router.post('/productos/:id/ajuste-stock', requirePermiso('catalogo.stock'), (req, res) =>
  res.json(catalogo.ajustarStock(req.params.id, body(req), req.user))
);
router.post('/productos/:id/stock-minimo', requirePermiso('catalogo.stock'), (req, res) =>
  res.json(catalogo.definirStockMinimo(req.params.id, body(req).stockMinimo))
);
router.get('/productos/:id/kardex', requirePermiso('catalogo.kardex'), (req, res) =>
  res.json(catalogo.kardex(req.params.id, { pagina: req.query.pagina, porPagina: req.query.porPagina }))
);

for (const [ruta, maestro] of [['categorias', catalogo.categorias], ['marcas', catalogo.marcas]]) {
  router.get(`/${ruta}`, verCatalogo, (req, res) => res.json(maestro.listar()));
  router.post(`/${ruta}`, gestionarCatalogo, (req, res) => res.json(maestro.crear(body(req).name)));
  router.put(`/${ruta}/:id`, gestionarCatalogo, (req, res) => res.json(maestro.renombrar(req.params.id, body(req).name)));
}

// ===== Caja =====
// El estado del turno es informativo para cualquier usuario con sesion (la
// interfaz decide a donde enviar al vendedor); operar exige permiso.
const operarCaja = requirePermiso('caja.operar');
router.get('/caja/estado', (req, res) => res.json(caja.estado()));
router.post('/caja/abrir', operarCaja, (req, res) => res.json(caja.abrir(req.user, body(req).monto)));
router.post('/caja/cerrar', operarCaja, (req, res) =>
  res.json(caja.cerrar(body(req).monto, { tarjeta: body(req).tarjeta, observacion: body(req).observacion, actor: req.user }))
);
router.get('/caja/historial', requirePermiso('ventas.ver'), (req, res) => res.json(caja.historial({ limite: req.query.limite })));
router.get('/caja/:id', requirePermiso('ventas.ver'), (req, res) => {
  const turno = caja.obtener(req.params.id);
  res.status(turno ? 200 : 404).json(turno ? { ok: true, caja: turno } : { ok: false, error: 'Caja no encontrada' });
});

// ===== Ventas =====
// Usuario y precios salen de la sesion y de la BD; se ignora lo que mande el cliente.
// ?mias=1 -> solo las del usuario en sesion ("Mis ventas" del web).
router.get('/ventas', requirePermiso('ventas.ver'), (req, res) =>
  res.json(ventas.listar({
    cajaId: req.query.caja,
    userId: req.query.mias === '1' ? req.user.id : undefined,
    horas: req.query.horas,
    limite: req.query.limite,
  }))
);
router.get('/ventas/:id', requirePermiso('ventas.ver'), (req, res) => {
  const venta = ventas.obtener(req.params.id);
  res.status(venta ? 200 : 404).json(venta ? { ok: true, venta } : { ok: false, error: 'Venta no encontrada' });
});
router.post('/ventas', requirePermiso('ventas.registrar'), (req, res) => {
  const { items, clienteId, cliente, tipoComprobante, medioPago, montoRecibido, montoEfectivo, referencia } = body(req);
  res.json(ventas.registrar({
    items, clienteId, cliente, tipoComprobante, medioPago, montoRecibido, montoEfectivo, referencia,
    puedeCrearCliente: permisos.tiene(req.user.type, 'clientes.crear'),
    usuario: req.user.nombre,
    userId: req.user.id,
  }));
});

// ===== Inicio (resumen segun permisos del rol) =====
router.get('/resumen', (req, res) => res.json(resumen.obtener(req.user)));

// ===== Sincronizacion =====
router.post('/sync', requirePermiso('sync.ejecutar'), async (req, res, next) => {
  try { res.json(await sync.sincronizar()); } catch (err) { next(err); }
});
router.get('/sync/estado', (req, res) => res.json(sync.estado()));

router.use((req, res) => res.status(404).json({ ok: false, error: 'Ruta no encontrada' }));

module.exports = router;
