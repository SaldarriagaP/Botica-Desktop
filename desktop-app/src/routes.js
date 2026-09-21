const express = require('express');
const auth = require('./auth');
const caja = require('./caja');
const clientes = require('./clientes');
const catalogo = require('./catalogo');
const ventas = require('./ventas');
const sync = require('./sync');

const router = express.Router();

// Exige que quien hace la accion sea un admin activo. El nombre de usuario
// se re-verifica contra la BD (no se confia en lo que mande el cliente).
function requireAdmin(req, res, next) {
  const actor = req.body.actorUsername || req.query.actorUsername;
  if (!auth.esAdminActivo(actor)) {
    return res.status(403).json({ ok: false, error: 'Esta acción requiere permisos de administrador' });
  }
  next();
}

// Modulo 1: autenticacion
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  res.json(auth.login(username, password));
});

router.get('/usuarios', requireAdmin, (req, res) => res.json(auth.listar()));
router.post('/usuarios', requireAdmin, (req, res) => res.json(auth.crear(req.body)));
router.post('/usuarios/:id/estado', requireAdmin, (req, res) =>
  res.json(auth.cambiarEstado(req.params.id, req.body.estado))
);

// Modulo 2: caja
router.get('/caja/estado', (req, res) => res.json(caja.estado()));
router.post('/caja/abrir', (req, res) => res.json(caja.abrir(req.body.usuario, req.body.monto)));
router.post('/caja/cerrar', (req, res) => res.json(caja.cerrar(req.body.monto)));

// Modulo 3: ventas
router.get('/ventas', (req, res) => res.json(ventas.listar()));
router.post('/ventas', (req, res) => res.json(ventas.registrar(req.body)));

// Modulo 4: clientes
router.get('/clientes', (req, res) =>
  res.json(clientes.listar(req.query.q, { soloActivos: req.query.soloActivos === '1' }))
);
router.post('/clientes', (req, res) => res.json(clientes.crear(req.body)));
router.put('/clientes/:id', requireAdmin, (req, res) => res.json(clientes.actualizar(req.params.id, req.body)));
router.post('/clientes/:id/estado', requireAdmin, (req, res) =>
  res.json(clientes.cambiarEstado(req.params.id, req.body.estado))
);

// Modulo 5: catalogo
router.get('/productos', (req, res) =>
  res.json(catalogo.listar(req.query.q, { soloActivos: req.query.soloActivos === '1' }))
);
router.post('/productos', requireAdmin, (req, res) => res.json(catalogo.crear(req.body)));
router.put('/productos/:id', requireAdmin, (req, res) => res.json(catalogo.actualizar(req.params.id, req.body)));
router.post('/productos/:id/estado', requireAdmin, (req, res) =>
  res.json(catalogo.cambiarEstado(req.params.id, req.body.estado))
);

// Modulo 6: sincronizacion
router.post('/sync', async (req, res) => res.json(await sync.sincronizar()));
router.get('/sync/estado', (req, res) => res.json({ lastSyncAt: sync.lastSyncAt() }));

module.exports = router;
