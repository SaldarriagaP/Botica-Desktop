// Cada archivo de prueba corre en su propio proceso (node --test), asi que
// basta con apuntar la BD a un archivo temporal ANTES de requerir src/db.

const fs = require('fs');
const os = require('os');
const path = require('path');

function usarBaseTemporal(nombre) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `botica-${nombre}-`));
  process.env.BOTICA_DATA_DIR = dir; // evita leer el data/config.json real
  process.env.BOTICA_DB_PATH = path.join(dir, 'test.sqlite3');
  delete process.env.BOTICA_LOCAL_ID;
  return dir;
}

async function levantarServidor() {
  const { createApp } = require('../src/app');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function pedir(ruta, { method = 'GET', token, body, rawBody } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + ruta, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* respuesta no JSON */ }
    return { status: res.status, json, texto };
  }

  async function loginToken(username, password) {
    const r = await pedir('/api/auth/login', { method: 'POST', body: { username, password } });
    if (!r.json || !r.json.ok) throw new Error(`Login fallo para ${username}: ${r.texto}`);
    return r.json.token;
  }

  return { server, base, pedir, loginToken, cerrar: () => new Promise((r) => server.close(r)) };
}

module.exports = { usarBaseTemporal, levantarServidor };
