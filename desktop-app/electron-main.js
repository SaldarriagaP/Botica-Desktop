const { app, BrowserWindow, Menu, dialog } = require('electron');

// Una sola instancia: si ya hay una ventana abierta, no arrancamos un
// segundo servidor Express en el mismo puerto (fallaría con EADDRINUSE).
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

  const { server, PORT } = require('./server.js');

  server.on('error', (err) => {
    dialog.showErrorBox(
      'No se pudo iniciar Desktop Botica',
      err.code === 'EADDRINUSE'
        ? `El puerto ${PORT} ya está en uso. Cierra cualquier otra copia de la app y vuelve a intentar.`
        : String(err)
    );
    app.quit();
  });

  function crearVentana() {
    const win = new BrowserWindow({
      width: 1200,
      height: 780,
      minWidth: 960,
      minHeight: 640,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#f5f7fa',
    });

    win.once('ready-to-show', () => win.show());

    const url = `http://localhost:${PORT}/login.html`;
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
