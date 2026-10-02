// Configuracion de la terminal (JSON).
// Orden de prioridad: variables de entorno > data/config.json (propio de
// cada sucursal, no se versiona) > config/default.json (valores de fabrica).

const path = require('path');
const fs = require('fs');

const DEFAULT_PATH = path.join(__dirname, '..', 'config', 'default.json');
const DATA_DIR = process.env.BOTICA_DATA_DIR || path.join(__dirname, '..', 'data');
const LOCAL_PATH = path.join(DATA_DIR, 'config.json');

function leerJson(ruta) {
  if (!fs.existsSync(ruta)) return {};
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    throw new Error(`El archivo de configuracion ${ruta} no es un JSON valido: ${err.message}`);
  }
}

function mezclar(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mezclar(base[k] || {}, v) : v;
  }
  return out;
}

const config = mezclar(leerJson(DEFAULT_PATH), leerJson(LOCAL_PATH));

if (process.env.BOTICA_LOCAL_ID) config.localId = Number(process.env.BOTICA_LOCAL_ID);
if (process.env.PORT) config.server.port = Number(process.env.PORT);
if (process.env.CENTRAL_URL) config.centralUrl = process.env.CENTRAL_URL;

config.dataDir = DATA_DIR;

module.exports = config;
