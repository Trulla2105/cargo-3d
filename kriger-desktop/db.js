// db.js — capa de base de datos SQLite real (archivo en el disco) usando sql.js.
// Corre dentro del proceso principal de Electron (no en la pantalla).
// Mantiene la MISMA forma de datos que el boceto original, pero guardada en
// tablas reales de SQLite, en un archivo .sqlite en la PC.

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS movimientos (
  id       TEXT PRIMARY KEY,
  tipo     TEXT NOT NULL,        -- venta | gasto | mover | pago
  fecha    TEXT NOT NULL,        -- YYYY-MM-DD
  cajero   TEXT,
  monto    REAL DEFAULT 0,       -- venta / mover / pago
  medio    TEXT,                 -- medio de pago (venta / pago)
  cliente  TEXT,
  contacto TEXT,
  nota     TEXT,
  remito   TEXT,                 -- venta en cuenta corriente: N° de remito
  concepto TEXT,                 -- gasto
  frente   REAL DEFAULT 0,       -- gasto: parte que sale del mostrador
  fondo    REAL DEFAULT 0,       -- gasto: parte que sale del fondo
  dir      TEXT                  -- mover: aFondo | aFrente
);
CREATE TABLE IF NOT EXISTS clientes (
  key    TEXT PRIMARY KEY,       -- nombre normalizado (minusculas)
  nombre TEXT,
  tel    TEXT,
  mail   TEXT,
  cuit   TEXT,
  dir    TEXT,
  notas  TEXT
);
CREATE TABLE IF NOT EXISTS arqueos (
  fecha  TEXT PRIMARY KEY,       -- YYYY-MM-DD
  frente TEXT,
  fondo  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_tipo  ON movimientos(tipo);
`;

let SQL = null;     // motor sql.js cargado
let db = null;      // base de datos en memoria
let dbPath = null;  // ruta del archivo .sqlite en el disco
let backupDir = null;

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

async function init(filePath, backupsFolder) {
  dbPath = filePath;
  backupDir = backupsFolder;
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: f => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f)
    });
  }
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  flushToDisk(); // asegura que el archivo exista desde el primer arranque
  return true;
}

// Lee TODAS las tablas y arma el objeto con la misma forma que usa la pantalla.
function loadStore() {
  const store = {
    config: { cajeros: [], saldoFrente: 0, saldoFondo: 0 },
    cajeroActual: null,
    movs: [],
    clientes: {},
    arqueos: {}
  };

  // config
  const cfg = db.exec('SELECT key, value FROM config');
  if (cfg.length) {
    for (const row of cfg[0].values) {
      const [k, v] = row;
      if (k === 'cajeros') { try { store.config.cajeros = JSON.parse(v) || []; } catch (e) { store.config.cajeros = []; } }
      else if (k === 'saldoFrente') store.config.saldoFrente = num(v);
      else if (k === 'saldoFondo') store.config.saldoFondo = num(v);
      else if (k === 'cajeroActual') store.cajeroActual = v || null;
      else if (k === 'fondoPin') store.config.fondoPin = v || '';
    }
  }

  // movimientos
  const mv = db.exec('SELECT id,tipo,fecha,cajero,monto,medio,cliente,contacto,nota,concepto,frente,fondo,dir,remito FROM movimientos');
  if (mv.length) {
    for (const r of mv[0].values) {
      const m = {
        id: r[0], t: r[1], fecha: r[2], cajero: r[3],
        monto: num(r[4]), medio: r[5], cliente: r[6], contacto: r[7],
        nota: r[8], concepto: r[9], frente: num(r[10]), fondo: num(r[11]), dir: r[12], remito: r[13]
      };
      // limpiar campos nulos para que se parezca al objeto original
      Object.keys(m).forEach(k => { if (m[k] === null) delete m[k]; });
      store.movs.push(m);
    }
  }

  // clientes
  const cl = db.exec('SELECT key,nombre,tel,mail,cuit,dir,notas FROM clientes');
  if (cl.length) {
    for (const r of cl[0].values) {
      store.clientes[r[0]] = {
        nombre: r[1] || '', tel: r[2] || '', mail: r[3] || '',
        cuit: r[4] || '', dir: r[5] || '', notas: r[6] || ''
      };
    }
  }

  // arqueos
  const ar = db.exec('SELECT fecha,frente,fondo FROM arqueos');
  if (ar.length) {
    for (const r of ar[0].values) {
      store.arqueos[r[0]] = { frente: r[1] || '', fondo: r[2] || '' };
    }
  }

  return store;
}

// Guarda TODO el estado actual en las tablas (en una sola transaccion) y
// escribe el archivo .sqlite en el disco.
function saveStore(store) {
  if (!db || !store) return false;
  db.run('BEGIN TRANSACTION');
  try {
    // config
    const setCfg = db.prepare('INSERT INTO config(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const cfg = store.config || {};
    setCfg.run(['cajeros', JSON.stringify(cfg.cajeros || [])]);
    setCfg.run(['saldoFrente', String(num(cfg.saldoFrente))]);
    setCfg.run(['saldoFondo', String(num(cfg.saldoFondo))]);
    setCfg.run(['cajeroActual', store.cajeroActual || '']);
    setCfg.run(['fondoPin', cfg.fondoPin || '']);
    setCfg.free();

    // movimientos (borrar y volver a escribir: simple y seguro para 1 usuario)
    db.run('DELETE FROM movimientos');
    const insMov = db.prepare('INSERT INTO movimientos(id,tipo,fecha,cajero,monto,medio,cliente,contacto,nota,concepto,frente,fondo,dir,remito) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const m of (store.movs || [])) {
      insMov.run([
        m.id, m.t, m.fecha, m.cajero || null,
        num(m.monto), m.medio || null, m.cliente || null, m.contacto || null,
        m.nota || null, m.concepto || null, num(m.frente), num(m.fondo), m.dir || null, m.remito || null
      ]);
    }
    insMov.free();

    // clientes
    db.run('DELETE FROM clientes');
    const insCli = db.prepare('INSERT INTO clientes(key,nombre,tel,mail,cuit,dir,notas) VALUES (?,?,?,?,?,?,?)');
    for (const [k, c] of Object.entries(store.clientes || {})) {
      insCli.run([k, c.nombre || '', c.tel || '', c.mail || '', c.cuit || '', c.dir || '', c.notas || '']);
    }
    insCli.free();

    // arqueos
    db.run('DELETE FROM arqueos');
    const insArq = db.prepare('INSERT INTO arqueos(fecha,frente,fondo) VALUES (?,?,?)');
    for (const [fecha, a] of Object.entries(store.arqueos || {})) {
      insArq.run([fecha, a.frente == null ? '' : String(a.frente), a.fondo == null ? '' : String(a.fondo)]);
    }
    insArq.free();

    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  flushToDisk();
  dailyBackup();
  return true;
}

function flushToDisk() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Copia automatica: una por dia (se sobrescribe durante el dia). Guarda las
// ultimas 30. Asi siempre hay puntos de restauracion sin que el usuario haga nada.
function dailyBackup() {
  try {
    if (!backupDir) return;
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    fs.copyFileSync(dbPath, path.join(backupDir, `kriger-${stamp}.sqlite`));
    // limpiar viejas
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('kriger-') && f.endsWith('.sqlite')).sort();
    while (files.length > 30) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(backupDir, old)); } catch (e) {}
    }
  } catch (e) { /* nunca romper el guardado por una copia */ }
}

// Copia manual a una carpeta elegida (pendrive, Drive, etc.)
function exportTo(targetFolder) {
  flushToDisk();
  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    '_' + String(d.getHours()).padStart(2, '0') + '-' + String(d.getMinutes()).padStart(2, '0');
  const dest = path.join(targetFolder, `kriger-respaldo-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, dest);
  return dest;
}

function info() {
  return { dbPath, backupDir };
}

module.exports = { init, loadStore, saveStore, exportTo, info };
