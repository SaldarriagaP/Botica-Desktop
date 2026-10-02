#!/usr/bin/env node
// Uso: npm run importar -- <ruta a botica.sql> [--sin-clientes] [--local=ID]
// Carga en la base local el catalogo, precios de la zona, stock de la
// sucursal y clientes del sistema web. Se puede volver a ejecutar.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
const localArg = args.find((a) => a.startsWith('--local='));
if (localArg) process.env.BOTICA_LOCAL_ID = localArg.split('=')[1];

if (!ruta) {
  console.error('Uso: npm run importar -- <ruta a botica.sql> [--sin-clientes] [--local=ID]');
  process.exit(1);
}
if (!fs.existsSync(ruta)) {
  console.error(`No existe el archivo: ${ruta}`);
  process.exit(1);
}

const config = require('../src/config');
const { importar } = require('../src/importacion');

console.log(`Leyendo ${path.resolve(ruta)} ...`);
const sql = fs.readFileSync(ruta, 'utf8');
const inicio = Date.now();
try {
  const resumen = importar(sql, { localId: config.localId, incluirClientes: !args.includes('--sin-clientes') });
  console.log(`Importación completada en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(resumen, null, 2));
} catch (err) {
  console.error(`La importación falló y no se modificó nada: ${err.message}`);
  process.exit(1);
}
