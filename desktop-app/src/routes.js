const express = require('express');
const auth = require('./auth');
const caja = require('./caja');
const clientes = require('./clientes');
const catalogo = require('./catalogo');
const ventas = require('./ventas');
const sync = require('./sync');

const router = express.Router();

// Modulo 1: autenticacion
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  res.json(auth.login(username, password));
});

// Modulo 2: caja
router.get('/caja/estado', (req, res) => res.json(caja.estado()));
router.post('/caja/abrir', (req, res) => res.json(caja.abrir(req.body.usuario, req.body.monto)));
router.post('/caja/cerrar', (req, res) => res.json(caja.cerrar(req.body.monto)));

// Modulo 3: ventas
router.get('/ventas', (req, res) => res.json(ventas.listar()));
router.post('/ventas', (req, res) => res.json(ventas.registrar(req.body)));

// Modulo 4: clientes
router.get('/clientes', (req, res) => res.json(clientes.listar(req.query.q)));
router.post('/clientes', (req, res) => res.json(clientes.crear(req.body)));

// Modulo 5: catalogo
router.get('/productos', (req, res) => res.json(catalogo.listar(req.query.q)));

// Modulo 6: sincronizacion
router.post('/sync', async (req, res) => res.json(await sync.sincronizar()));
router.get('/sync/estado', (req, res) => res.json({ lastSyncAt: sync.lastSyncAt() }));

module.exports = router;
