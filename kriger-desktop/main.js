// main.js — proceso principal de Electron.
// Abre la ventana, prepara la base de datos en la carpeta de datos de la PC,
// y atiende los pedidos de la pantalla (cargar / guardar / copia de seguridad).

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const importExcel = require('./import-excel');
const report = require('./report');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (e) { /* opcional */ }

let win = null;

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Publica el resumen en el "buzón" online (si está configurado). Con un pequeño
// retraso para juntar varios guardados seguidos en uno.
let _pubT = null;
function publishLater(store) {
  const cfg = (store && store.config) || {};
  if (!cfg.viewerUrl || !cfg.viewerWriteKey) return;
  clearTimeout(_pubT);
  _pubT = setTimeout(() => { publishNow(store).catch(() => {}); }, 1500);
}
async function publishNow(store) {
  const cfg = (store && store.config) || {};
  if (!cfg.viewerUrl || !cfg.viewerWriteKey) return { ok: false, error: 'sin configurar' };
  const snap = report.buildReport(store, todayStr());
  const base = String(cfg.viewerUrl).replace(/\/+$/, '');
  const res = await fetch(base + '/push?key=' + encodeURIComponent(cfg.viewerWriteKey), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snap)
  });
  return { ok: res.ok, status: res.status };
}

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
  try { db.saveStore(store); publishLater(store); return { ok: true }; }
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

// Código del "buzón" (Worker de Cloudflare) con las claves ya completadas.
ipcMain.handle('viewer:workerCode', async () => {
  try {
    const cfg = db.loadStore().config || {};
    let code = fs.readFileSync(path.join(__dirname, 'cloudflare-worker.js'), 'utf8');
    code = code.split('__WRITEKEY__').join(cfg.viewerWriteKey || '').split('__READKEY__').join(cfg.viewerReadKey || '');
    return { ok: true, code };
  } catch (e) { return { ok: false, error: String(e) }; }
});

// Publica ahora (botón "Probar") y avisa si salió bien.
ipcMain.handle('viewer:test', async () => {
  try { return await publishNow(db.loadStore()); }
  catch (e) { return { ok: false, error: String(e) }; }
});

// Enlace para el celular + QR.
ipcMain.handle('viewer:phoneLink', async () => {
  const cfg = db.loadStore().config || {};
  if (!cfg.viewerUrl || !cfg.viewerReadKey) return { ok: false };
  const base = String(cfg.viewerUrl).replace(/\/+$/, '');
  const link = base + '/?k=' + encodeURIComponent(cfg.viewerReadKey);
  let qr = '';
  if (QRCode) { try { qr = await QRCode.toDataURL(link, { margin: 1, width: 200 }); } catch (e) {} }
  return { ok: true, link, qr };
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
