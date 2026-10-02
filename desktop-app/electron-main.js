const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

// Una sola instancia: si ya hay una ventana abierta, no arrancamos un
// segundo servidor Express en el mismo puerto (fallaria con EADDRINUSE).
const tieneLock = app.requestSingleInstanceLock();
if (!tieneLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  Menu.setApplicationMenu(null);

  let server, PORT, HOST;
  try {
    ({ server, PORT, HOST } = require('./server.js'));
  } catch (err) {
    // Ej. base de datos danada o sucursal mal configurada: mostrar el motivo
    // en vez de cerrar la app sin ningun mensaje.
    app.whenReady().then(() => {
      dialog.showErrorBox('No se pudo iniciar Desktop Botica', String(err && err.message ? err.message : err));
      app.quit();
    });
  }

  if (server) {
    server.on('error', (err) => {
      dialog.showErrorBox(
        'No se pudo iniciar Desktop Botica',
        err.code === 'EADDRINUSE'
          ? `El puerto ${PORT} ya está en uso. Cierra cualquier otra copia de la app y vuelve a intentar.`
          : String(err)
      );
      app.quit();
    });

    const ORIGEN = `http://${HOST}:${PORT}`;

    function crearVentana() {
      const win = new BrowserWindow({
        width: 1200,
        height: 780,
        minWidth: 960,
        minHeight: 640,
        autoHideMenuBar: true,
        show: false,
        backgroundColor: '#f5f7fa',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      win.once('ready-to-show', () => win.show());

      // La ventana solo navega dentro de la app local; cualquier enlace
      // externo se abre en el navegador del sistema.
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url) && !url.startsWith(ORIGEN)) shell.openExternal(url);
        return { action: 'deny' };
      });
      win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(ORIGEN)) event.preventDefault();
      });

      const url = `${ORIGEN}/login.html`;
      if (server.listening) {
        win.loadURL(url);
      } else {
        server.once('listening', () => win.loadURL(url));
      }
    }

    app.whenReady().then(crearVentana);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
