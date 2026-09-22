const express = require('express');
const { db } = require('./db');
const auth = require('./auth');
const caja = require('./caja');
const sync = require('./sync');

const router = express.Router();

// Modulo 1: Autenticacion
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  auth.login(username, password, (err, result) => {
    if (err) return res.status(500).json({ ok: false, error: 'Error de servidor' });
    if (!result.ok) return res.status(401).json(result);
    res.json(result);
  });
});

// Modulo 2: Caja
router.get('/caja/estado', (req, res) => {
  db.get('SELECT * FROM caja ORDER BY id DESC LIMIT 1', [], (err, row) => {
    res.json(row || { abierta: 0 });
  });
});

router.post('/caja/abrir', (req, res) => {
  const { usuario, monto } = req.body;
  const opened_at = new Date().toISOString();
  db.run(
    'INSERT INTO caja (abierta, monto_apertura, usuario, opened_at) VALUES (1, ?, ?, ?)',
    [monto, usuario, opened_at],
    function(err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

router.post('/caja/cerrar', (req, res) => {
  const { monto } = req.body;
  const closed_at = new Date().toISOString();
  db.run(
    'UPDATE caja SET abierta = 0, monto_cierre = ?, closed_at = ? WHERE abierta = 1',
    [monto, closed_at],
    function(err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true });
    }
  );
});

// Modulo 3: Ventas
router.get('/ventas', (req, res) => {
  db.all('SELECT * FROM sales ORDER BY id DESC', [], (err, rows) => {
    res.json(err ? [] : rows);
  });
});

router.post('/ventas', (req, res) => {
  const { cliente_id, usuario, items, total } = req.body;
  const fecha = new Date().toISOString();
  const items_json = JSON.stringify(items || []);

  db.run(
    'INSERT INTO sales (fecha, cliente_id, usuario, items_json, total) VALUES (?, ?, ?, ?, ?)',
    [fecha, cliente_id, usuario, items_json, total],
    function(err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// Modulo 4: Clientes
router.get('/clientes', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  db.all('SELECT * FROM customers WHERE nombre LIKE ? OR documento LIKE ?', [q, q], (err, rows) => {
    res.json(err ? [] : rows);
  });
});

router.post('/clientes', (req, res) => {
  const { nombre, documento, telefono } = req.body;
  db.run(
    'INSERT INTO customers (nombre, documento, telefono) VALUES (?, ?, ?)',
    [nombre, documento, telefono],
    function(err) {
      if (err) return res.status(500).json({ ok: false, error: err.message });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// Modulo 5: Productos (Catálogo)
router.get('/productos', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  db.all('SELECT * FROM products WHERE nombre LIKE ? OR codigo_barras LIKE ?', [q, q], (err, rows) => {
    res.json(err ? [] : rows);
  });
});

// Modulo 6: Sincronizacion
router.post('/sync', async (req, res) => res.json({ ok: true }));
router.get('/sync/estado', (req, res) => res.json({ lastSyncAt: null }));

module.exports = router;