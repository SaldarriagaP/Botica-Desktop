// Servidor central de prueba (simula a Botica Solidaria en línea).
// Por ahora solo tiene 2 endpoints: catálogo y recepción de ventas.
// TODO: clientes, usuarios, stock por sucursal, endpoint de salud.

const express = require('express');
const app = express();
app.use(express.json());

const productos = [
  { id: 101, nombre: 'Paracetamol 500mg', precio: 0.35 },
  { id: 102, nombre: 'Amoxicilina 500mg', precio: 1.8 },
  { id: 103, nombre: 'Ibuprofeno 400mg', precio: 0.4 },
  { id: 104, nombre: 'Loratadina 10mg', precio: 0.6 },
  { id: 105, nombre: 'Suero fisiologico 500ml', precio: 6.5 },
];

const ventasRecibidas = [];

app.get('/api/productos', (req, res) => res.json(productos));

app.post('/api/ventas', (req, res) => {
  ventasRecibidas.push(req.body);
  console.log(`Venta recibida (id local ${req.body.id}), total S/ ${req.body.total}`);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Mock central server escuchando en http://localhost:${PORT}`));
