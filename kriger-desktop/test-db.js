// test-db.js — prueba la capa de base de datos sin abrir la app.
// Verifica: crear archivo, guardar, leer, que todo coincida, y la copia.
// Correr con: npm run test:db

const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');

function assert(cond, msg) { if (!cond) { console.error('FALLO:', msg); process.exitCode = 1; } else console.log('ok  -', msg); }

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kriger-test-'));
  const dbPath = path.join(tmp, 'kriger.sqlite');
  const backupDir = path.join(tmp, 'copias');

  await db.init(dbPath, backupDir);
  assert(fs.existsSync(dbPath), 'crea el archivo .sqlite en el disco');

  // arranca vacio
  let s = db.loadStore();
  assert(s.movs.length === 0, 'arranca sin movimientos');
  assert(Array.isArray(s.config.cajeros), 'config.cajeros es una lista');

  // armo un estado realista
  s.config.cajeros = ['Seba', 'Gisela'];
  s.config.saldoFrente = 10000;
  s.config.saldoFondo = 50000;
  s.config.fondoPin = '1234';
  s.cajeroActual = 'Seba';
  s.movs.push({ id: 'a1', t: 'venta', fecha: '2026-06-30', cajero: 'Seba', monto: 8500, medio: 'efectivo', cliente: 'Juan', contacto: 'presencial', nota: 'remera M' });
  s.movs.push({ id: 'a2', t: 'venta', fecha: '2026-06-30', cajero: 'Seba', monto: 12000, medio: 'cta corriente', cliente: 'Ana', remito: 'R-0012' });
  s.movs.push({ id: 'a3', t: 'gasto', fecha: '2026-06-30', cajero: 'Seba', concepto: 'sueldo', frente: 200, fondo: 600 });
  s.movs.push({ id: 'a4', t: 'mover', fecha: '2026-06-30', cajero: 'Seba', monto: 5000, dir: 'aFondo' });
  s.movs.push({ id: 'a5', t: 'pago', fecha: '2026-06-30', cajero: 'Seba', cliente: 'Juan', monto: 3000, medio: 'efectivo', nota: 'pago cta cte' });
  s.clientes['juan'] = { nombre: 'Juan', tel: '11-2222', mail: '', cuit: '20-111', dir: 'Calle 1', notas: 'mayorista' };
  s.arqueos['2026-06-30'] = { frente: '15000', fondo: '54400' };

  db.saveStore(s);

  // leo de nuevo (otra instancia: cierro y reabro el archivo)
  delete require.cache[require.resolve('./db')];
  const db2 = require('./db');
  await db2.init(dbPath, backupDir);
  const r = db2.loadStore();

  assert(r.config.cajeros.length === 2 && r.config.cajeros[0] === 'Seba', 'guarda y lee los cajeros');
  assert(r.config.saldoFrente === 10000 && r.config.saldoFondo === 50000, 'guarda y lee los saldos iniciales');
  assert(r.config.fondoPin === '1234', 'guarda la clave del fondo');
  assert(r.cajeroActual === 'Seba', 'guarda el cajero actual');
  assert(r.movs.length === 5, 'guarda los 5 movimientos');

  const venta = r.movs.find(m => m.id === 'a1');
  assert(venta && venta.t === 'venta' && venta.monto === 8500 && venta.cliente === 'Juan', 'la venta se reconstruye igual');
  const gasto = r.movs.find(m => m.id === 'a3');
  assert(gasto && gasto.frente === 200 && gasto.fondo === 600, 'el gasto dividido conserva las dos partes');
  const mover = r.movs.find(m => m.id === 'a4');
  assert(mover && mover.dir === 'aFondo' && mover.monto === 5000, 'el pase entre cajas se conserva');
  const ctacte = r.movs.find(m => m.id === 'a2');
  assert(ctacte && ctacte.medio === 'cta corriente' && ctacte.remito === 'R-0012', 'la venta en cuenta corriente guarda el N° de remito');

  assert(r.clientes['juan'] && r.clientes['juan'].tel === '11-2222', 'guarda la ficha del cliente');
  assert(r.arqueos['2026-06-30'] && r.arqueos['2026-06-30'].frente === '15000', 'guarda el arqueo del dia');

  // copia manual
  const dest = db2.exportTo(tmp);
  assert(fs.existsSync(dest), 'la copia manual genera un archivo de respaldo');

  // copia automatica diaria
  const autos = fs.readdirSync(backupDir).filter(f => f.endsWith('.sqlite'));
  assert(autos.length >= 1, 'la copia automatica diaria se genero');

  // borrar un movimiento y reguardar
  r.movs = r.movs.filter(m => m.id !== 'a2');
  db2.saveStore(r);
  const r2 = db2.loadStore();
  assert(r2.movs.length === 4, 'borrar un movimiento se persiste');

  console.log('\nFecha de la prueba:', '2026-06-30', '- todo verificado.');
})();
