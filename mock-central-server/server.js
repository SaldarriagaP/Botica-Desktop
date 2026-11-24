// Servidor central de prueba (simula a Botica Solidaria en linea).
// Endpoints: salud, catalogo de precios y recepcion de ventas.
// La recepcion de ventas es idempotente: si la terminal reintenta una venta
// que ya llego (sucursal + serie + correlativo), responde ok sin duplicarla.

const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));

// Precios por central_id (los ids del sistema web).
const productos = [
  { id: 101, nombre: 'Paracetamol 500mg', precio: 25 },
  { id: 102, nombre: 'Amoxicilina 500mg', precio: 60 },
  { id: 103, nombre: 'Ibuprofeno 400mg', precio: 30 },
  { id: 104, nombre: 'Loratadina 10mg', precio: 5 },
  { id: 105, nombre: 'Suero fisiologico 500ml', precio: 6.5 },
];

const ventasRecibidas = new Map();

app.get('/api/health', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

app.get('/api/productos', (req, res) => res.json(productos));

app.post('/api/ventas', (req, res) => {
  const v = req.body || {};
  if (!Number.isInteger(v.id) || !(Number(v.total) > 0) || !Array.isArray(v.items) || !v.items.length) {
    return res.status(400).json({ ok: false, error: 'Venta incompleta: faltan id, total o items' });
  }
  const clave = v.serie && v.correlativo ? `${v.local_id}:${v.serie}-${v.correlativo}` : `${v.local_id}:local-${v.id}`;
  if (ventasRecibidas.has(clave)) return res.json({ ok: true, duplicada: true });
  ventasRecibidas.set(clave, v);
  console.log(`Venta recibida ${clave} (${v.tipo_comprobante || 'boleta'}), total S/ ${v.total}`);
  res.json({ ok: true });
});

app.get('/api/ventas', (req, res) => res.json([...ventasRecibidas.values()]));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Mock central server escuchando en http://localhost:${PORT}`));
