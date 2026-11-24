// Crea la app Express (API local + interfaz). Separado de server.js para
// que las pruebas puedan levantarla en un puerto libre.

const path = require('path');
const express = require('express');
const config = require('./config');
const { db } = require('./db');
const { seed } = require('./seedData');

function validarTerminal() {
  const local = db.prepare('SELECT id FROM locals WHERE id = ?').get(config.localId);
  if (!local) {
    throw new Error(
      `La sucursal configurada (localId = ${config.localId}) no existe. Revisa config/default.json o data/config.json.`
    );
  }
}

function createApp() {
  validarTerminal();
  seed(db);

  const routes = require('./routes');
  const app = express();
  app.disable('x-powered-by');
  // Cabeceras de seguridad: solo se ejecuta codigo propio de la app (sin
  // scripts inline ni eval), sin marcos externos ni deteccion de tipo MIME.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', routes);

  // JSON mal formado u otros errores: siempre responder JSON, sin stack.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'Solicitud con formato inválido' });
    }
    console.error(err);
    res.status(500).json({ ok: false, error: 'Error interno de la aplicación' });
  });

  return app;
}

module.exports = { createApp };
