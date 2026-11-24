const path = require('path');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

// En la app instalada (.exe) la carpeta del programa se reemplaza en cada
// actualizacion, asi que la base de datos y la config de la sucursal se
// guardan en %APPDATA%\Desktop Botica\data, que sobrevive a las updates.
if (app.isPackaged && !process.env.BOTICA_DATA_DIR) {
  process.env.BOTICA_DATA_DIR = path.join(app.getPath('userData'), 'data');
}

// Busca una version nueva en GitHub Releases, la descarga en segundo plano
// y ofrece reiniciar para instalarla. Solo aplica a la app instalada.
function configurarActualizaciones() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('electron-updater no disponible:', err);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Actualización disponible',
      message: `Se descargó la versión ${info.version} de Desktop Botica.`,
      detail: 'Reinicia para aplicarla. Si eliges "Más tarde", se instalará al cerrar la app.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    // Sin internet u otra falla: la app sigue funcionando offline.
    console.error('Error buscando actualizaciones:', err && err.message ? err.message : err);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  // Revisa de nuevo cada 2 horas por si la app queda abierta todo el dia.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 2 * 60 * 60 * 1000);
}

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

    app.whenReady().then(() => {
      crearVentana();
      configurarActualizaciones();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
