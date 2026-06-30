// main.js — proceso principal de Electron.
// Abre la ventana, prepara la base de datos en la carpeta de datos de la PC,
// y atiende los pedidos de la pantalla (cargar / guardar / copia de seguridad).

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const db = require('./db');
const importExcel = require('./import-excel');
const viewerServer = require('./viewer-server');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { /* opcional */ }

let win = null;

function dataDir() {
  // Carpeta privada de la app dentro del perfil del usuario de Windows.
  // Ej: C:\Users\lizzi\AppData\Roaming\Kriger
  return app.getPath('userData');
}

async function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    minHeight: 640,
    backgroundColor: '#EDEDE8',
    title: 'Kriger',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const dbPath = path.join(dataDir(), 'kriger.sqlite');
  const backupDir = path.join(dataDir(), 'copias-de-seguridad');
  await db.init(dbPath, backupDir);

  // Visor de solo lectura para el celular (misma red WiFi).
  try { await viewerServer.start(() => db.loadStore(), 7777); }
  catch (e) { console.warn('No se pudo iniciar el visor:', e); }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Pedidos desde la pantalla -------------------------------------------

ipcMain.handle('store:load', async () => {
  try { return { ok: true, store: db.loadStore() }; }
  catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('store:save', async (_evt, store) => {
  try { db.saveStore(store); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('backup:export', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elegí dónde guardar la copia (pendrive, Drive, carpeta…)',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Guardar copia acá'
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    const dest = db.exportTo(res.filePaths[0]);
    return { ok: true, dest };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('db:info', async () => {
  const i = db.info();
  return i;
});

ipcMain.handle('db:openFolder', async () => {
  const i = db.info();
  shell.showItemInFolder(i.dbPath);
  return { ok: true };
});

// Datos del visor de celular (dirección + QR).
ipcMain.handle('viewer:info', async () => {
  const i = viewerServer.info();
  let qr = '';
  if (i.url && QRCode) {
    try { qr = await QRCode.toDataURL(i.url, { margin: 1, width: 220 }); } catch (e) {}
  }
  return { url: i.url, ip: i.ip, port: i.port, qr };
});

// Elegir el Excel y leerlo (sin importar todavía): devuelve un resumen.
ipcMain.handle('excel:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elegí tu archivo de Excel con las ventas',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls', 'csv'] }]
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const parsed = importExcel.parse(res.filePaths[0]);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, filePath: res.filePaths[0], resumen: parsed.resumen };
});

// Importar de verdad: hace copia de seguridad y agrega los datos.
ipcMain.handle('excel:import', async (_evt, filePath) => {
  try {
    const parsed = importExcel.parse(filePath);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    db.backupLabeled('antes-de-importar');
    const resumen = db.mergeImport(parsed);
    return { ok: true, resumen };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
