const { app, BrowserWindow } = require('electron');

console.log('>>> [1] Iniciando electron-main.js...');

try {
  console.log('>>> [2] Cargando server.js...');
  require('./server.js');
  console.log('>>> [3] server.js cargado correctamente.');
} catch (err) {
  console.error('>>> CRASH EN SERVER.JS:', err.stack || err);
}

function crearVentana() {
  console.log('>>> [4] Creando ventana principal...');
  const win = new BrowserWindow({ 
    width: 1100, 
    height: 750, 
  });
  win.webContents.openDevTools();
  win.loadURL('http://localhost:4500/login.html');
}

app.whenReady().then(crearVentana);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
