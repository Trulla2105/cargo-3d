// import-excel.js — lee un Excel de ventas (formato Kriger "caja diaria") y lo
// convierte a movimientos para la base de datos. No toca la base: solo lee y
// arma los datos + un resumen para mostrar antes de importar.

const XLSX = require('xlsx');

// Mapa de método de pago del Excel -> medios de la app.
const MEDIO_MAP = {
  'efectivo': 'efectivo',
  'transferencia': 'transferencia',
  'cheque': 'cheque',
  'deposito': 'deposito',
  'depósito': 'deposito',
  'cc': 'cta corriente',
  'cuenta corriente': 'cta corriente',
  'cta corriente': 'cta corriente'
};
// Contacto del Excel -> contacto de la app.
const CONTACTO_MAP = {
  'presencial': 'presencial',
  'whatsapp': 'whatsapp',
  'cc': 'cc',
  'comisionista': 'comisionista',
  'seña': 'seña',
  'sena': 'seña'
};

function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
// Unifica el nombre del cajero (jenny / Jenny / JENNY -> Jenny) para que no
// queden duplicados por mayúsculas.
function titleCase(s) { s = String(s == null ? '' : s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

// Serial de Excel -> 'YYYY-MM-DD' (sistema de fechas 1900).
function serialToYMD(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// Convierte cualquier valor de celda de fecha a 'YYYY-MM-DD' (o null).
function toYMD(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToYMD(v);
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  const s = String(v).trim();
  // dd/mm/yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) { let [_, d, mo, y] = m; if (y.length === 2) y = '20' + y; return y + '-' + mo.padStart(2, '0') + '-' + d.padStart(2, '0'); }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  return null;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
  if (!s) return 0;
  const c = s.includes(','), d = s.includes('.');
  if (c && d) s = s.replace(/\./g, '').replace(',', '.');
  else if (c) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function uid(i) { return 'imp' + Date.now().toString(36) + i.toString(36); }

// Busca el índice de una columna por nombre (tolerante a mayúsculas/acentos).
function findCol(headers, names) {
  const H = headers.map(h => norm(h));
  for (const name of names) {
    const i = H.indexOf(norm(name));
    if (i >= 0) return i;
  }
  return -1;
}

// Lee el archivo y devuelve { ok, movs, clientes, cajeros, resumen } o { ok:false, error }.
function parse(filePath) {
  let wb;
  try { wb = XLSX.readFile(filePath, { raw: true, cellDates: false }); }
  catch (e) { return { ok: false, error: 'No se pudo abrir el archivo: ' + e.message }; }

  // Buscamos la hoja de ventas: "caja diaria" o la primera que tenga las columnas.
  let sheetName = wb.SheetNames.find(n => norm(n) === 'caja diaria') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return { ok: false, error: 'No se encontró la hoja de ventas.' };

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!rows.length) return { ok: false, error: 'La hoja está vacía.' };

  const headers = rows[0];
  const iFecha = findCol(headers, ['FECHA', 'fecha']);
  const iCajero = findCol(headers, ['CAJERO', 'cajero', 'vendedor']);
  const iCliente = findCol(headers, ['CLIENTE', 'cliente']);
  const iNota = findCol(headers, ['INCIDENCIA', 'NOTA', 'nota', 'detalle']);
  const iTotal = findCol(headers, ['TOTAL', 'total', 'monto', 'importe']);
  const iMedio = findCol(headers, ['METODO DE PAGO', 'MÉTODO DE PAGO', 'metodo de pago', 'medio', 'medio de pago']);
  const iContacto = findCol(headers, ['CONTACTO', 'contacto']);

  if (iFecha < 0 || iTotal < 0) {
    return { ok: false, error: 'No encontré las columnas FECHA y TOTAL en la hoja "' + sheetName + '".' };
  }

  const movs = [];
  const clientes = {};
  const cajeroCount = {};
  let saltadasFecha = 0, saltadasVacias = 0;
  let sumaTotal = 0, fechaMin = null, fechaMax = null;
  const porAnio = {};

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const rawFecha = row[iFecha];
    const monto = toNumber(row[iTotal]);
    if ((rawFecha == null || rawFecha === '') && !monto) { saltadasVacias++; continue; }

    const fecha = toYMD(rawFecha);
    const anio = fecha ? +fecha.slice(0, 4) : 0;
    if (!fecha || anio < 2000 || anio > 2100) { saltadasFecha++; continue; }
    if (!monto) { saltadasVacias++; continue; }

    const cajero = iCajero >= 0 ? titleCase(row[iCajero]) : '';
    const cliente = iCliente >= 0 ? String(row[iCliente] || '').trim() : '';
    let notaRaw = iNota >= 0 ? row[iNota] : null;
    const nota = (notaRaw == null || notaRaw === '') ? '' : String(notaRaw).trim();
    const medio = MEDIO_MAP[norm(row[iMedio >= 0 ? iMedio : -1])] || 'efectivo';
    const contacto = CONTACTO_MAP[norm(row[iContacto >= 0 ? iContacto : -1])] || 'presencial';

    movs.push({ id: uid(r), t: 'venta', fecha, cajero, cliente, monto, medio, contacto, nota });

    if (cliente) {
      const k = norm(cliente);
      if (!clientes[k]) clientes[k] = { nombre: cliente, tel: '', mail: '', cuit: '', dir: '', notas: '' };
    }
    if (cajero) cajeroCount[cajero] = (cajeroCount[cajero] || 0) + 1;

    sumaTotal += monto;
    if (!fechaMin || fecha < fechaMin) fechaMin = fecha;
    if (!fechaMax || fecha > fechaMax) fechaMax = fecha;
    porAnio[anio] = (porAnio[anio] || 0) + 1;
  }

  // Cajeros para la lista de selección: los que aparecen al menos 3 veces
  // (así no entran tipeos sueltos). Si ninguno llega, tomamos todos.
  let cajeros = Object.keys(cajeroCount).filter(c => cajeroCount[c] >= 3);
  if (!cajeros.length) cajeros = Object.keys(cajeroCount);
  cajeros.sort((a, b) => cajeroCount[b] - cajeroCount[a]);

  return {
    ok: true,
    movs,
    clientes,
    cajeros,
    resumen: {
      hoja: sheetName,
      ventas: movs.length,
      clientes: Object.keys(clientes).length,
      cajeros,
      sumaTotal,
      fechaMin,
      fechaMax,
      porAnio,
      saltadasFecha,
      saltadasVacias
    }
  };
}

module.exports = { parse };
