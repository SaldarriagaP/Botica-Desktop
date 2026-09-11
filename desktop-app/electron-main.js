const { app, BrowserWindow } = require('electron');
require('./server.js');

function crearVentana() {
  const win = new BrowserWindow({ width: 1100, height: 750 });
  win.loadURL('http://localhost:4500/login.html');
}

app.whenReady().then(crearVentana);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
