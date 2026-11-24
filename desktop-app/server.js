const config = require('./src/config');
const { createApp } = require('./src/app');
const sync = require('./src/sync');

const app = createApp();
const { host, port: PORT } = config.server;

// Solo escucha en 127.0.0.1: la API local no queda expuesta a la red.
const server = app.listen(PORT, host, () => {
  console.log(`Desktop Botica escuchando en http://${host}:${PORT} (sucursal ${config.localId})`);
  // Sube las ventas pendientes en cuanto el central vuelve a responder.
  if (sync.iniciarAutomatica()) {
    console.log(`Sincronizacion automatica cada ${config.sync.automaticoSegundos} s con ${config.centralUrl}`);
  }
});

module.exports = { app, server, PORT, HOST: host };
